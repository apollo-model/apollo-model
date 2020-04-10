import { GraphQLInputObjectType, GraphQLList } from 'graphql';
import R from 'ramda';
import {
  AMInputFieldConfigMap,
  AMInputObjectType,
  AMModelField,
  AMModelType,
  AMTypeFactory,
  IAMInputFieldFactory,
  IAMTypeFactory,
} from '../definitions';
import { AMDataContext } from '../execution/contexts/data';
import { AMObjectFieldContext } from '../execution/contexts/objectField';
import {
  getFieldPath,
  getLastOperation,
  getOperationData,
} from '../execution/utils';
import { toArray } from '../utils';
import { defaultObjectFieldVisitorHandler } from './visitorHandlers';

const isApplicable = (field: AMModelField) => (
  fieldFactory: IAMInputFieldFactory
) => fieldFactory.isApplicable(field);

export class AMUpdateManyNestedTypeFactory extends AMTypeFactory<
  GraphQLInputObjectType
> {
  getTypeName(modelType: AMModelType): string {
    return `${modelType.name}UpdateManyNestedInput`;
  }
  getType(modelType: AMModelType) {
    const typeName = this.getTypeName(modelType);

    const self: IAMTypeFactory<AMInputObjectType> = this;

    return new AMInputObjectType({
      name: typeName,
      fields: () => {
        const fields = <AMInputFieldConfigMap>{
          create: {
            type: new GraphQLList(
              this.configResolver.resolveInputType(modelType, this.links.create)
            ),
            ...defaultObjectFieldVisitorHandler('create'),
          },
          recreate: {
            type: new GraphQLList(
              this.configResolver.resolveInputType(
                modelType,
                this.links.recreate
              )
            ),
            ...defaultObjectFieldVisitorHandler('recreate'),
          },
          updateMany: {
            type: new GraphQLList(
              this.configResolver.resolveInputType(
                modelType,
                this.links.updateMany //AMUpdateWithWhereNestedTypeFactory
              )
            ),
            amEnter(node, transaction, stack) {
              // const context = new AMDataContext();
              // stack.push(context);
            },
            amLeave(node, transaction, stack) {
              const lastInStack = R.last(stack);
              if (lastInStack instanceof AMDataContext) {
                lastInStack.addValue('updateMany', true);
              }
            },
          },
          deleteMany: {
            type: new GraphQLList(
              this.configResolver.resolveInputType(
                modelType,
                this.links.deleteMany //AMWhereTypeFactory
              )
            ),
            ...defaultObjectFieldVisitorHandler('deleteMany'),
          },
        };

        return fields;
      },
      amEnter(node, transaction, stack) {
        const context = new AMDataContext();
        stack.push(context);
      },
      amLeave(node, transaction, stack) {
        const operation = getLastOperation(stack);
        const path = getFieldPath(stack, operation);
        const context = stack.pop() as AMDataContext;
        const lastInStack = R.last(stack);

        const data = getOperationData(stack, operation);
        if (!context.data || Object.keys(context.data).length != 1) {
          throw new Error(`${typeName} should contain one field`);
        }

        if (context.data.create) {
          const push = (data.data && data.data['$push']) || {};
          data.addValue('$push', push);
          push[path] = { $each: toArray(context.data.create) };
        }

        if (context.data.recreate) {
          if (lastInStack instanceof AMObjectFieldContext) {
            lastInStack.setValue(toArray(context.data.recreate));
          }
        }

        if (context.data.updateMany) {
          // console.log('update many');
        }
      },
    });
  }
}