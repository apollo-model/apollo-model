import { GraphQLSchema, isObjectType } from 'graphql';
import R from 'ramda';
import { AMField, AMModelField } from '../types';
import { AMFieldsSelectionContext } from '../execution/contexts/fieldsSelection';
import { AMOperation } from '../execution/operation';
import { AMReadOperation } from '../execution/operations/readOperation';
import { AMSelectorContext } from '../execution/contexts/selector';
import { getLastOperation, getFieldsSelectionPath } from '../execution/utils';
import { AMObjectFieldContext } from '../execution/contexts/objectField';
import { start } from 'repl';

export const addVisitorEvents = (schema: GraphQLSchema) => {
  Object.values(schema.getTypeMap()).forEach(type => {
    if (isObjectType(type)) {
      Object.values(type.getFields()).forEach((field: AMModelField) => {
        if (field.relation) {
          field.amEnter = (node, transaction, stack) => {
            const lastStackItem = R.last(stack);
            if (lastStackItem instanceof AMFieldsSelectionContext) {
              if (!field.relation.external) {
                lastStackItem.addField(field.relation.storeField);
              } else {
                lastStackItem.addField(field.relation.relationField);
              }
            }

            const lastOperation = getLastOperation(stack);
            let path = getFieldsSelectionPath(stack, lastOperation);

            if (field.relation.external) {
              const pathArr = path.split('.');
              pathArr.pop();
              pathArr.push(field.name);
              path = pathArr.join('.');
            }

            const relationOperation = new AMReadOperation(transaction, {
              many: true,
              collectionName: field.relation.collection,
              selector: new AMSelectorContext(
                !field.relation.external
                  ? {
                      [field.relation.relationField]: {
                        $in: lastOperation.getResult().distinct(path),
                      },
                    }
                  : {
                      [field.relation.storeField]: {
                        $in: lastOperation
                          .getResult()
                          .distinct(field.relation.relationField),
                      },
                    }
              ),
            });
            stack.push(relationOperation);

            if (!field.relation.external) {
              lastOperation.setOutput(
                lastOperation
                  .getOutput()
                  .distinctReplace(path, field.relation.relationField, () =>
                    relationOperation.getOutput()
                  )
              );
            } else {
              lastOperation.setOutput(
                lastOperation
                  .getOutput()
                  .lookup(
                    path,
                    field.relation.relationField,
                    field.relation.storeField,
                    () => relationOperation.getOutput()
                  )
              );
            }
          };
          field.amLeave = (node, transaction, stack) => {
            const relationOperation = stack.pop();
          };
        } else {
          field.amEnter = (node, transaction, stack) => {
            const lastStackItem = R.last(stack);
            if (lastStackItem instanceof AMFieldsSelectionContext) {
              lastStackItem.addField(field.dbName);
            }
          };
          // field.amLeave=(node, transaction, stack)=>{
          // },
        }
      });
    }
  });
};