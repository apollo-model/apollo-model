import {
  GET_LIST,
  GET_ONE,
  GET_MANY,
  GET_MANY_REFERENCE,
  CREATE,
  UPDATE,
  DELETE,
} from 'react-admin';
import * as R from 'ramda';
import TypeWrap from '@apollo-model/type-wrap';

import isObject from 'lodash/isObject';

import getFinalType from './utils/getFinalType';
import { computeFieldsToAddRemoveUpdate } from './utils/computeAddRemoveUpdate';

import {
  PRISMA_CONNECT,
  PRISMA_DISCONNECT,
  PRISMA_UPDATE,
} from './constants/mutations';
import {
  IntrospectionInputObjectType,
  IntrospectionObjectType,
  IntrospectionType,
  IntrospectionNamedTypeRef,
  isScalarType,
  GraphQLInputObjectType,
  GraphQLScalarType,
  getNamedType,
} from 'graphql';
import { IntrospectionResultData, Resource } from './definitions';
import { IntrospectionResult } from './introspectionResult';

interface GetListParams {
  filter: { [key: string]: any };
  pagination: { page: number; perPage: number };
  sort: { field: string; order: string };
}

//TODO: Object filter weren't tested yet
const buildGetListVariables = (
  introspectionResults: IntrospectionResultData
) => (resource: Resource, aorFetchType: string, params: GetListParams) => {
  const filter = Object.keys(params.filter).reduce((acc, key) => {
    if (key === 'ids') {
      return { ...acc, id_in: params.filter[key] };
    }

    if (Array.isArray(params.filter[key])) {
      const type = introspectionResults.types.find(
        t => t.name === `${resource.type.name}WhereInput`
      ) as IntrospectionInputObjectType;
      const inputField = type.inputFields.find((t: any) => t.name === key);

      if (!!inputField) {
        return {
          ...acc,
          [key]: params.filter[key],
        };
      }
    }

    if (isObject(params.filter[key])) {
      const type = introspectionResults.types.find(
        t => t.name === `${resource.type.name}WhereInput`
      ) as IntrospectionInputObjectType;
      const filterSome = type.inputFields.find(
        (t: any) => t.name === `${key}_some`
      );

      if (filterSome) {
        const filter = Object.keys(params.filter[key]).reduce(
          (acc, k: string) => ({
            ...acc,
            [`${k}_in`]: params.filter[key][k] as string[],
          }),
          {} as { [key: string]: string[] }
        );
        return { ...acc, [`${key}_some`]: filter };
      }
    }

    const parts = key.split('.');

    if (parts.length > 1) {
      if (parts[1] == 'id') {
        const type = introspectionResults.types.find(
          t => t.name === `${resource.type.name}WhereInput`
        ) as IntrospectionInputObjectType;
        const filterSome = type.inputFields.find(
          (t: any) => t.name === `${parts[0]}_some`
        );

        if (filterSome) {
          return {
            ...acc,
            [`${parts[0]}_some`]: { id: params.filter[key] },
          };
        }

        return { ...acc, [parts[0]]: { id: params.filter[key] } };
      }

      const resourceField = (resource.type as IntrospectionObjectType).fields.find(
        (f: any) => f.name === parts[0]
      )!;
      if ((resourceField.type as IntrospectionNamedTypeRef).name === 'Int') {
        return { ...acc, [key]: parseInt(params.filter[key]) };
      }
      if ((resourceField.type as IntrospectionNamedTypeRef).name === 'Float') {
        return { ...acc, [key]: parseFloat(params.filter[key]) };
      }
    }

    return { ...acc, [key]: params.filter[key] };
  }, {});

  return {
    skip: (params.pagination.page - 1) * params.pagination.perPage,
    first: params.pagination.perPage,
    orderBy: `${params.sort.field}_${params.sort.order}`,
    where: filter,
  };
};

const findInputFieldForType = (
  introspectionResults: IntrospectionResultData,
  typeName: string,
  field: string
) => {
  const type = introspectionResults.types.find(
    t => t.name === typeName
  ) as IntrospectionInputObjectType;

  if (!type) {
    return null;
  }

  //to search for the schema type of related ids
  const fieldName = typeExistsForRelatedIds(field);

  const inputFieldType = type.inputFields.find(
    (t: any) => t.name === fieldName
  );

  return !!inputFieldType ? getFinalType(inputFieldType.type) : null;
};

const inputFieldExistsForType = (
  introspectionResults: IntrospectionResultData,
  typeName: string,
  field: string
): boolean => {
  return !!findInputFieldForType(introspectionResults, typeName, field);
};

const typeExistsForRelatedIds = (key: string) => {
  const idsStringIndex = key.indexOf('Ids');

  return idsStringIndex !== -1 ? key.substr(0, idsStringIndex) : key;
};

const isJsonTypeField = (fields: Array<object>, key: string): boolean => {
  const field = fields.find((t: any) => (t.name === key ? t : null));
  const fieldType = field
    ? (<any>field).type.name || (<any>field).type.ofType.name
    : null;

  return fieldType && fieldType === 'Json';
};

const buildReferenceField = ({
  inputArg,
  introspectionResults,
  typeName,
  field,
  mutationType,
}: {
  inputArg: { [key: string]: any };
  introspectionResults: IntrospectionResultData;
  typeName: string;
  field: string;
  mutationType: string;
}) => {
  const inputType = findInputFieldForType(
    introspectionResults,
    typeName,
    field
  );
  const mutationInputType = findInputFieldForType(
    introspectionResults,
    inputType!.name,
    mutationType
  );

  return Object.keys(inputArg).reduce((acc, key) => {
    return inputFieldExistsForType(
      introspectionResults,
      mutationInputType!.name,
      key
    )
      ? { ...acc, [key]: inputArg[key] }
      : acc;
  }, {});
};

interface UpdateParams {
  id: string;
  data: { [key: string]: any };
  previousData: { [key: string]: any };
}

const buildUpdateVariables = (
  introspectionResults: IntrospectionResultData,
  introspection: IntrospectionResult
) => (resource: Resource, aorFetchType: String, params: UpdateParams) => {
  const type = R.find(R.propEq('name', resource.type.name))(
    introspectionResults.types
  ) as IntrospectionObjectType;

  const updateType = introspection.getUpdateDataType(resource.type.name);

  return Object.entries(params.data).reduce((acc, [key, value]) => {
    if (key === 'id' && params.data[key]) {
      return {
        ...acc,
        where: {
          id: value,
        },
      };
    }

    const field = updateType.getFields()[key];
    if (field) {
      let resultValue;

      const realType = getNamedType(field.type) as
        | GraphQLScalarType
        | GraphQLInputObjectType;

      if (isScalarType(realType)) {
        resultValue = value;
      } else {
        if (realType.name.endsWith('UpdateOneRelationInput')) {
          const connectType = realType.getFields()['connect']
            .type as GraphQLInputObjectType;
          if (connectType.name.endsWith('InterfaceWhereUniqueInput')) {
            const interfaceName = Object.keys(connectType.getFields())[0];
            resultValue = { connect: { [interfaceName]: value } };
          } else {
            resultValue = { connect: value };
          }
        } else if (realType.name.endsWith('UpdateManyRelationInput')) {
          const reconnectType = getNamedType(
            realType.getFields()['reconnect'].type
          ) as GraphQLInputObjectType;

          if (reconnectType.name.endsWith('InterfaceWhereUniqueInput')) {
            const interfaceName = Object.keys(reconnectType.getFields())[0];
            resultValue = {
              reconnect: value.map(v => ({ [interfaceName]: v })),
            };
          } else {
            resultValue = { reconnect: value };
          }
        }
      }

      return {
        ...acc,
        data: {
          ...acc.data,
          [key]: resultValue,
        },
      };
    }
    // //to work with JSON array
    // const isJsonField = isJsonTypeField([...type.fields], key);
    // if (isJsonField) {
    //   return {
    //     ...acc,
    //     data: {
    //       ...acc.data,
    //       [key]: params.data[key],
    //     },
    //   };
    // }

    // if (Array.isArray(params.data[key])) {
    //   const inputType = findInputFieldForType(
    //     introspectionResults,
    //     `${resource.type.name}UpdateInput`,
    //     key
    //   );

    //   if (!inputType) {
    //     return acc;
    //   }

    //   //TODO: Make connect, disconnect and update overridable
    //   //TODO: Make updates working

    //   //to search for the schema type of related ids
    //   const fieldName = typeExistsForRelatedIds(key);

    //   const {
    //     fieldsToAdd,
    //     fieldsToRemove /* fieldsToUpdate */,
    //   } = computeFieldsToAddRemoveUpdate(
    //     params.previousData[key],
    //     params.data[key]
    //   );

    //   return {
    //     ...acc,
    //     data: {
    //       ...acc.data,
    //       [fieldName]: {
    //         [PRISMA_CONNECT]: fieldsToAdd,
    //         [PRISMA_DISCONNECT]: fieldsToRemove,
    //         //[PRISMA_UPDATE]: fieldsToUpdate
    //       },
    //     },
    //   };
    // }

    // if (
    //   isObject(params.data[key]) &&
    //   Object.prototype.toString.call(params.data[key]) !== '[object Date]'
    // ) {
    //   const fieldsToUpdate = buildReferenceField({
    //     inputArg: params.data[key],
    //     introspectionResults,
    //     typeName: `${resource.type.name}UpdateInput`,
    //     field: key,
    //     mutationType: PRISMA_CONNECT,
    //   });

    //   // If no fields in the object are valid, continue
    //   if (Object.keys(fieldsToUpdate).length === 0) {
    //     return acc;
    //   }

    //   // Else, connect the nodes
    //   return {
    //     ...acc,
    //     data: {
    //       ...acc.data,
    //       [key]: { [PRISMA_CONNECT]: { ...fieldsToUpdate } },
    //     },
    //   };
    // }

    // // Put id field in a where object
    // if (key === 'id' && params.data[key]) {
    //   return {
    //     ...acc,
    //     where: {
    //       id: params.data[key],
    //     },
    //   };
    // }

    // const isInField = type.fields.find((t: any) => t.name === key);

    // if (!!isInField) {
    //   // Rest should be put in data object
    //   return {
    //     ...acc,
    //     data: {
    //       ...acc.data,
    //       [key]: params.data[key],
    //     },
    //   };
    // }

    // return acc;
    return acc;
  }, {} as { [key: string]: any });
};

interface CreateParams {
  data: { [key: string]: any };
}
const buildCreateVariables = (
  introspectionResults: IntrospectionResultData
) => (resource: Resource, aorFetchType: string, params: CreateParams) =>
  Object.keys(params.data).reduce((acc, key) => {
    const type = introspectionResults.types.find(
      t => t.name === resource.type.name
    ) as IntrospectionObjectType;

    //to work with JSON array
    const isJsonField = isJsonTypeField([...type.fields], key);
    if (isJsonField) {
      return {
        ...acc,
        data: {
          ...acc.data,
          [key]: params.data[key],
        },
      };
    }

    if (Array.isArray(params.data[key])) {
      if (
        !inputFieldExistsForType(
          introspectionResults,
          `${resource.type.name}CreateInput`,
          key
        )
      ) {
        return acc;
      }

      //to search for the schema type of related ids
      const fieldName = typeExistsForRelatedIds(key);

      return {
        ...acc,
        data: {
          ...acc.data,
          [fieldName]: {
            [PRISMA_CONNECT]: params.data[key].map((id: string) => ({
              id,
            })),
          },
        },
      };
    }

    if (
      isObject(params.data[key]) &&
      Object.prototype.toString.call(params.data[key]) !== '[object Date]'
    ) {
      const fieldsToConnect = buildReferenceField({
        inputArg: params.data[key],
        introspectionResults,
        typeName: `${resource.type.name}CreateInput`,
        field: key,
        mutationType: PRISMA_CONNECT,
      });

      // If no fields in the object are valid, continue
      if (Object.keys(fieldsToConnect).length === 0) {
        return acc;
      }

      // Else, connect the nodes
      return {
        ...acc,
        data: {
          ...acc.data,
          [key]: { [PRISMA_CONNECT]: { ...fieldsToConnect } },
        },
      };
    }

    // Put id field in a where object
    if (key === 'id' && params.data[key]) {
      return {
        ...acc,
        where: {
          id: params.data[key],
        },
      };
    }

    const isInField = type.fields.find((t: any) => t.name === key);

    if (isInField) {
      // Rest should be put in data object
      return {
        ...acc,
        data: {
          ...acc.data,
          [key]: params.data[key],
        },
      };
    }

    return acc;
  }, {} as { [key: string]: any });

export default (
  introspectionResults: IntrospectionResultData,
  introspection: IntrospectionResult
) => (resource: Resource, aorFetchType: string, params: any) => {
  switch (aorFetchType) {
    case GET_LIST: {
      return buildGetListVariables(introspectionResults)(
        resource,
        aorFetchType,
        params
      );
    }
    case GET_MANY:
      return {
        where: { id_in: params.ids },
      };
    case GET_MANY_REFERENCE: {
      const parts = params.target.split('.');

      return {
        where: { [parts[0]]: { id: params.id } },
      };
    }
    case GET_ONE:
      return {
        where: { id: params.id },
      };
    case UPDATE: {
      return buildUpdateVariables(introspectionResults, introspection)(
        resource,
        aorFetchType,
        params
      );
    }

    case CREATE: {
      return buildCreateVariables(introspectionResults)(
        resource,
        aorFetchType,
        params
      );
    }

    case DELETE:
      return {
        where: { id: params.id },
      };
  }
};
