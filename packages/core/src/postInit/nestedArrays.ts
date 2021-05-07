import TypeWrap from '@apollo-model/type-wrap';
import {
  GraphQLSchema,
  isInterfaceType,
  isObjectType,
  FieldNode,
} from 'graphql';
import { firstArg } from '../args/first';
import { skipArg } from '../args/skip';
import { AMConfigResolver } from '../config/resolver';
import { AMModelField, AMModelType } from '../definitions';
import { AMObjectFieldContext, AMFieldsSelectionContext } from '../execution';
import { ResultPromiseTransforms } from '../execution/resultPromise';

export const nestedArrays = (
  schema: GraphQLSchema,
  configResolver: AMConfigResolver
) => {
  Object.values(schema.getTypeMap()).forEach((type: AMModelType) => {
    if (type.mmModel || type.mmEmbedded || type.mmModelInherited) {
      Object.values(type.getFields()).forEach((field: AMModelField) => {
        if (field.noArrayFilter) return;
        const typeWrap = new TypeWrap(field.type);
        const realType = typeWrap.realType() as AMModelType;
        if (
          typeWrap.isMany() &&
          !field.relation &&
          (isObjectType(realType) || isInterfaceType(realType))
        ) {
          field.args = [
            {
              name: 'where',
              description: null,
              extensions: undefined,
              astNode: undefined,
              type: configResolver.resolveInputType(realType, 'where'),
              defaultValue: undefined,
              amEnter: (node, transaction, stack) => {
                stack.push(new AMObjectFieldContext());
              },
              amLeave: (node, transaction, stack) => {
                const context = stack.pop() as AMObjectFieldContext;
                const operation = stack.lastOperation();
                const path = stack.path(operation);
                const displayField = path.pop();
                operation.setOutput(
                  operation.getOutput().map(
                    new ResultPromiseTransforms.TransformArray(
                      path,
                      displayField,
                      field.dbName,
                      {
                        where: context.value as {},
                      }
                    )
                  )
                );
                return;
              },
            },

            {
              name: 'orderBy',
              description: null,
              extensions: undefined,
              astNode: undefined,
              type: configResolver.resolveInputType(realType, 'orderBy'),
              defaultValue: undefined,
            },
            skipArg,
            firstArg,
          ];

          field.amEnter = (node: FieldNode, transaction, stack) => {
            const lastStackItem = stack.last();
            if (lastStackItem instanceof AMFieldsSelectionContext) {
              lastStackItem.addField(field.dbName);
            }
            /**
             * Filtered arrays should be stored in field with name of alias
             */
            if (node.alias && node.arguments?.length > 0) {
              /**
               * Add $ prefix to prevent collision with real fields
               */
              stack.leavePath();
              stack.enterPath(`$${node.alias.value}`, field.dbName);
            }
          };

          field.resolve = (source, args, ctx, info) => {
            if (source.fieldName !== info.path.key) {
              if (
                info.fieldNodes[0].alias &&
                info.fieldNodes[0].arguments?.length > 0
              ) {
                return source[`$${info.path.key}`];
              }
            }
            return source[info.fieldName];
          };
        }
      });
    }
  });
};