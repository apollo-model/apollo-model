import pluralize from 'pluralize';
import R from 'ramda';

export { applyRules } from './applyRules';
export { modelDefaultActions } from './modelDefaultActions';
export { modelField } from './modelField';
import { modelField } from './modelField';

export const operationAccessRule = regex => () => {};

export const regexFields = regex => ({ type, field }) => {
  return regex.test(`${type.name}.${field.name}`);
};

export const anyField = ({ type, field }) => {
  return !['Query', 'Mutation', 'Subscription'].includes(type.name);
};

export const allQueries = ({ type, field }) => {
  return type.name === 'Query';
};

export const allMutations = ({ type, field }) => {
  return type.name === 'Mutation';
};

export const modelCustomActions = (modelName, actions: string[]) => {
  const modelNameToRegExp = model =>
    actions.map(action => new RegExp(`^Mutation\\.${action}${model}$`));

  const modelNames = [modelName, pluralize(modelName)];
  const enableFields = R.pipe(
    R.chain(modelNameToRegExp),
    R.map(R.test)
  )(modelNames);

  return ({ type, field }) => {
    return R.anyPass(enableFields)(`${type.name}.${field.name}`);
  };
};

export const modelDefault = (modelName, fieldName, access, fn) => {
  return {
    cond: modelField(modelName, fieldName, access),
    fn,
  };
};
