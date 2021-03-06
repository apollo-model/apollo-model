import TypeWrap from '@graphex/type-wrap';
import * as R from 'ramda';

export const capitalizeFirstLetter = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

const reduceArgs = (map, arg) => {
  map[arg.name] = arg;
  return map;
};

export const getFields = (stackItem) => stackItem.type.getFields();
export const getArgs = (stackItem) => stackItem.args;

export const getNameValue = (node) => node.name.value;
export const getFragmentTypeName = (node) => node.typeCondition.name.value;

export const mapTypeForTypeStack = (type) => ({ type });

export const mapFieldForTypeStack = (field) => ({
  type: new TypeWrap(field.type).realType(),
  args: field.args.reduce(reduceArgs, {}),
});

export const mapNodeForTypeStack = (node) => ({
  type: new TypeWrap(node.type).realType(),
});

export const groupFields = (predicate, object) => {
  const result = {};
  for (const key in object) {
    const predicateValue = predicate(object[key]);
    if (!result[predicateValue]) result[predicateValue] = {};
    result[predicateValue][key] = object[key];
  }
  return result;
};

export const reduceValues = (values) => {
  return values.reduce((state, item) => {
    state[item.name] = R.omit(['deprecationReason', 'isDeprecated'], item);
    return state;
  }, {});
};
