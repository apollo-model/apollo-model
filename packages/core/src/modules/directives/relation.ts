import gql from 'graphql-tag';
import { SchemaDirectiveVisitor } from 'graphql-tools';
import { AMModelField } from '../../definitions';

export const typeDef = gql`
  directive @relation(
    field: String = "_id"
    storeField: String = null
  ) on FIELD_DEFINITION
`;

export class RelationDirective extends SchemaDirectiveVisitor {
  visitFieldDefinition(field: AMModelField, { objectType }) {
    // let { field: relationField, storeField } = this.args;
    // const typeWrap = new TypeWrap(field.type);
    // const type = typeWrap.realType() as AMModelType;
    // if (!storeField)
    //   storeField = getRelationFieldName(
    //     type.name,
    //     relationField,
    //     typeWrap.isMany()
    //   );
    // field.relation = {
    //   external: false,
    //   relationField: relationField,
    //   storeField: storeField,
    //   collection: type.mmCollectionName,
    // };
    // appendTransform(field, HANDLER.TRANSFORM_TO_INPUT, {
    //   [INPUT_TYPE_KIND.ORDER_BY]: field => [],
    //   [INPUT_TYPE_KIND.CREATE]: field => [],
    //   [INPUT_TYPE_KIND.UPDATE]: field => [],
    //   [INPUT_TYPE_KIND.WHERE]: field => [],
    // });
  }
}

// const DirectiveRealationResolver = (next, source, args, ctx, info) => {
//   const { storeField } = args;
//   //TODO: move to operation putput transformation
//   info.fieldName = info.parentType.getFields()[
//     info.fieldName
//   ].relation.storeField;
//   return next();
// };

export const schemaDirectives = {
  relation: RelationDirective,
};

// export const directiveResolvers = {
//   relation: DirectiveRealationResolver,
// };
