import { GraphQLInputObjectType, GraphQLList } from 'graphql';
import {
  AMInputObjectType,
  AMModelType,
  AMTypeFactory,
} from '../../../definitions';
import { AMDataContext } from '../../../execution/contexts/data';
import { AMObjectFieldContext } from '../../../execution/contexts/objectField';
import { toArray } from '../../../utils';
import { defaultObjectFieldVisitorHandler } from '../../common/visitorHandlers';

export class AMUpdateManyNestedTypeFactory extends AMTypeFactory<GraphQLInputObjectType> {
  getTypeName(modelType: AMModelType): string {
    return `${modelType.name}UpdateManyNestedInput`;
  }
  getType(modelType: AMModelType) {
    const typeName = this.getTypeName(modelType);

    return new AMInputObjectType({
      name: typeName,
      fields: () => {
        const fields = {
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
            amLeave(node, transaction, stack) {
              const lastInStack = stack.last();
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
        const operation = stack.lastOperation();
        const path = stack.getFieldPath(operation);
        const context = stack.pop() as AMDataContext;
        const lastInStack = stack.last();

        const data = stack.getOperationData(operation);
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
