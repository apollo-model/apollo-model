import {
  GraphQLList,
  GraphQLNonNull,
  getNamedType,
  isScalarType,
} from 'graphql';
import { AMField, AMModelType, IAMFieldFactory } from '../definitions';
import { resolve } from '../resolve';
import { AMFederationAnyTypeFactory } from './anyType';
import { AMFederationEntityTypeFactory } from './entityType';
import { AMReadEntitiesOperation } from '../execution/operations/readEntitiesOperation';
import { AMDataContext } from '../execution/contexts/data';
import { AMObjectFieldContext } from '../execution/contexts/objectField';
import { getLastOperation } from '../execution/utils';
import R from 'ramda';

export const AMFederationEntitiesFieldFactory: IAMFieldFactory = {
  getFieldName(): string {
    return '_entities';
  },
  getField(inputType: AMModelType, schemaInfo) {
    return <AMField>{
      name: this.getFieldName(),
      description: '',
      isDeprecated: false,
      type: new GraphQLNonNull(
        new GraphQLList(
          schemaInfo.resolveFactoryType(null, AMFederationEntityTypeFactory)
        )
      ),
      args: [
        {
          name: 'representations',
          type: new GraphQLNonNull(
            new GraphQLList(
              new GraphQLNonNull(
                schemaInfo.resolveFactoryType(null, AMFederationAnyTypeFactory)
              )
            )
          ),
          amEnter(node, transaction, stack) {
            const context = new AMObjectFieldContext();
            stack.push(context);
          },
          amLeave(node, transaction, stack) {
            const context = stack.pop() as AMObjectFieldContext;

            const lastOperation = getLastOperation(
              stack
            ) as AMReadEntitiesOperation;

            const normalizedRepresentations = (context.value as {
              [k: string]: any;
            }[]).map(({ __typename, ...where }) => {
              const type = schemaInfo.schema.getType(__typename) as AMModelType;
              const fields = type.getFields();

              const mapParseScalars = ([fieldName, value]) => {
                const fieldType = getNamedType(fields[fieldName].type);
                if (isScalarType(fieldType)) {
                  return [fieldName, fieldType.parseValue(value)];
                } else {
                  return [fieldName, value];
                }
              };

              const mapFieldName = ([fieldName, value]) => {
                return [fields[fieldName].dbName, value];
              };

              const collectionName = type.mmCollectionName;
              const selector = R.pipe(
                Object.entries,
                R.map(R.pipe(mapParseScalars, mapFieldName)),
                Object.fromEntries
              )(where);

              return { collectionName, selector, typename: __typename };
            });

            lastOperation.setRepresentations(normalizedRepresentations);
          },
        },
      ],
      amEnter(node, transaction, stack) {
        const context = new AMReadEntitiesOperation(transaction, {});
        stack.push(context);
      },
      amLeave(node, transaction, stack) {
        stack.pop();
      },
      resolve: resolve,
    };
  },
};