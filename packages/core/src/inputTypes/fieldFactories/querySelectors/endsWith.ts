import { getNamedType, isCompositeType } from 'graphql';
import { AMModelField } from '../../../definitions';
import { AMQuerySelectorFieldFactory } from '../querySelector';

export class EndsWithSelector extends AMQuerySelectorFieldFactory {
  isApplicable(field: AMModelField) {
    return getNamedType(field.type).toString() === 'String';
  }
  getFieldName(field: AMModelField) {
    return `${field.name}_ends_with`;
  }
  getFieldType(field: AMModelField) {
    const namedType = getNamedType(field.type);

    if (!isCompositeType(namedType)) {
      return namedType;
    }
  }
  transformValue(value: any) {
    return {
      $regex: new RegExp(`${value}$`),
    };
  }
}
