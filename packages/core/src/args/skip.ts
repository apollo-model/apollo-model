import { GraphQLInt } from 'graphql';
import { AMArgumet } from '../definitions';
import { AMObjectFieldContext } from '../execution/contexts/objectField';
import { AMOperation } from '../execution/operation';

export const skipArg: AMArgumet = {
  name: 'skip',
  type: GraphQLInt,
  description: undefined,
  defaultValue: undefined,
  astNode: undefined,
  extensions: undefined,
  amEnter(node, transaction, stack) {
    const context = new AMObjectFieldContext('arg');
    stack.push(context);
  },
  amLeave(node, transaction, stack) {
    const context = stack.pop() as AMObjectFieldContext;
    const lastInStack = stack.last();

    if (lastInStack instanceof AMOperation) {
      lastInStack.setSkip(context.value as number);
    }
  },
};