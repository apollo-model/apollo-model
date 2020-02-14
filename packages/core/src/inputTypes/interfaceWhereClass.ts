import {
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  isInterfaceType,
} from 'graphql';
import R from 'ramda';
import { AMCreateOperation } from '../execution/operations/createOperation';
import {
  AMInputFieldConfig,
  AMInputObjectType,
  AMModelType,
  IAMTypeFactory,
  AMTypeFactory,
} from '../definitions';
import { AMWhereTypeFactory } from './where';
import { AMOperation } from '../execution/operation';
import { AMObjectFieldContext } from '../execution/contexts/objectField';
import { AMReadOperation } from '../execution/operations/readOperation';

export class AMInterfaceWhereTypeFactory extends AMTypeFactory<
  AMInputObjectType
> {
  isApplicable(type: AMModelType) {
    return isInterfaceType(type);
  }
  getTypeName(modelType: AMModelType): string {
    return `${modelType.name}InterfaceWhereInput`;
  }
  getType(modelType: AMModelType) {
    return new AMInputObjectType({
      name: this.getTypeName(modelType),
      fields: () => {
        const fields = {};
        if (modelType instanceof GraphQLInterfaceType) {
          [
            modelType,
            ...(this.schemaInfo.schema.getPossibleTypes(
              modelType
            ) as AMModelType[]),
          ].forEach((possibleType: AMModelType) => {
            fields[possibleType.name] = <AMInputFieldConfig>{
              type: this.configResolver.resolveInputType(
                possibleType,
                this.links.where
              ),
              ...(!modelType.mmAbstract
                ? {
                    // amEnter(node, transaction, stack) {
                    //   },
                    amLeave(node, transaction, stack) {
                      if (
                        modelType.mmDiscriminatorField &&
                        possibleType.mmDiscriminator
                      ) {
                        const lastInStack = R.last(stack);
                        if (lastInStack instanceof AMReadOperation) {
                          if (lastInStack.selector) {
                            lastInStack.selector.addValue(
                              modelType.mmDiscriminatorField,
                              possibleType.mmDiscriminator
                            );
                          }
                        } else if (
                          lastInStack instanceof AMObjectFieldContext
                        ) {
                          lastInStack.addValue(
                            modelType.mmDiscriminatorField,
                            possibleType.mmDiscriminator
                          );
                        }
                      }
                    },
                  }
                : {
                    // amEnter(node, transaction, stack) {
                    //   const createOperation = new AMCreateOperation(
                    //     transaction,
                    //     {
                    //       many: false,
                    //       collectionName: possibleType.mmCollectionName,
                    //     }
                    //   );
                    //   stack.push(createOperation);
                    // },
                    // amLeave(node, transaction, stack) {
                    //   const createOp = stack.pop() as AMCreateOperation;
                    //   const lastInStack = R.last(stack);
                    //   if (lastInStack instanceof AMObjectFieldContext) {
                    //     lastInStack.setValue(
                    //       createOp
                    //         .getOutput()
                    //         .path('_id')
                    //         .dbRef(possibleType.mmCollectionName)
                    //     );
                    //   } else if (lastInStack instanceof AMListValueContext) {
                    //     lastInStack.addValue(
                    //       createOp
                    //         .getOutput()
                    //         .path('_id')
                    //         .dbRef(possibleType.mmCollectionName)
                    //     );
                    //   }
                    // },
                  }),
            };
          });
        }

        return fields;
      },
    });
  }
}
