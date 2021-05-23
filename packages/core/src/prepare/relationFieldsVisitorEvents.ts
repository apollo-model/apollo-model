import { DBRef } from 'bson';
import {
  FieldNode,
  GraphQLSchema,
  isInterfaceType,
  isObjectType,
} from 'graphql';
import { AMModelField, RelationInfo } from '../definitions';
import { AMFieldsSelectionContext } from '../execution/contexts/fieldsSelection';
import { AMSelectorContext } from '../execution/contexts/selector';
import { AMOperation } from '../execution/operation';
import { AMAggregateOperation } from '../execution/operations/aggregateOperation';
import { AMConnectionOperation } from '../execution/operations/connectionOperation';
import { AMReadDBRefOperation } from '../execution/operations/readDbRefOperation';
import { AMReadOperation } from '../execution/operations/readOperation';
import { Path } from '../execution/path';
import { ResultPromiseTransforms } from '../execution/resultPromise';
import { Batch } from '../execution/resultPromise/batch';
import { AMTransaction } from '../execution/transaction';
import { AMVisitorStack } from '../execution/visitorStack';
import { sameArguments } from './utils';

export const relationFieldsVisitorEvents = (schema: GraphQLSchema) => {
  Object.values(schema.getTypeMap()).forEach(type => {
    if (isObjectType(type) || isInterfaceType(type)) {
      Object.values(type.getFields()).forEach((field: AMModelField) => {
        if (field.relation || field.nodesRelation || field.aggregateRelation) {
          field.resolve = async (source, args, ctx, info) => {
            return ctx.fieldsRegistry.get(info.fieldNodes[0])(source);
          };

          field.amEnter = (node: FieldNode, transaction, stack) => {
            const lastOperation = stack.lastOperation();
            const isInConnection =
              lastOperation instanceof AMConnectionOperation;
            const relationInfo = getRelationInfo({
              parentDataOperation: lastOperation,
              field,
            });
            const isRootConnectionQuery = relationInfo.storeField === null;

            /**
             * Relations data should be stored in field with name of an alias
             * Add $ prefix to prevent collision with real fields
             */
            changeContextCurrentPath({ node, relationInfo, stack });
            pushFieldIntoSelectionContext({ relationInfo, stack });

            const rootOperation = transaction.operations[0];
            // const rootCondition = stack.condition(rootOperation);

            const childDataPath = stack.path(rootOperation);

            let { relationOperation, resolve } = getExistingOperation({
              args: node.arguments,
              rootOperation,
              childDataPath,
            });

            /**
             * Create new operation if there is no existing
             */
            if (!relationOperation) {
              // TODO replace with relation kind enum
              const createOperation = isRootConnectionQuery
                ? !field.aggregateRelation
                  ? createReadOperation
                  : createAggregateOperation
                : !field.aggregateRelation
                ? relationInfo.abstract
                  ? createAbstractBelongsToRelationOperation
                  : relationInfo.external
                  ? createHasRelationOperation
                  : createBelongsToRelationOperation
                : createHasAggregateRelationOperation;

              ({ relationOperation, resolve } = createOperation({
                relationInfo,
                transaction,
                filter: isInConnection
                  ? lastOperation.selector?.selector
                  : undefined,
              }));

              rootOperation.addRelationOperation(childDataPath, {
                relationOperation,
                resolve,
                args: node.arguments,
              });
            }

            stack.push(relationOperation);

            transaction.fieldsRegistry.set(node, resolve);
          };
          field.amLeave = (node, transaction, stack) => {
            stack.pop();
          };
        }
      });
    }
  });
};

const getRelationInfo = ({
  parentDataOperation,
  field,
}: {
  parentDataOperation: AMOperation;
  field: AMModelField;
}) => {
  if (parentDataOperation instanceof AMConnectionOperation) {
    return parentDataOperation.relationInfo;
  }
  return field.relation;
};

const getChildDataStoreField = (node: FieldNode) => {
  /**
   * Results of children operations should be stored
   * in parent operation result
   * under different keys for each alias.
   */
  return node.alias //
    ? `$${node.alias.value}`
    : node.name.value;
};

const changeContextCurrentPath = ({
  node,
  relationInfo,
  stack,
}: {
  node: FieldNode;
  relationInfo: RelationInfo;
  stack: AMVisitorStack;
}) => {
  const pathItem = getChildDataStoreField(node);
  const dbPathItem = relationInfo.external
    ? undefined
    : relationInfo.storeField;

  stack.leavePath();
  stack.enterPath(pathItem, dbPathItem);
};

const pushFieldIntoSelectionContext = ({
  relationInfo,
  stack,
}: {
  relationInfo: RelationInfo;
  stack: AMVisitorStack;
}) => {
  /**
   * For connections put required fields into parent context
   */
  let context = stack.last();
  const lastOperation = stack.lastOperation();
  if (lastOperation instanceof AMConnectionOperation) {
    const idx = stack.rightIndexOf(lastOperation);
    context = stack.last(idx + 1);
  }
  /**
   * -----
   */

  if (context instanceof AMFieldsSelectionContext) {
    if (!relationInfo.external) {
      context.addField(relationInfo.storeField);
    } else {
      context.addField(relationInfo.relationField);
    }
  }
};

type CreateRelationOperationParams = {
  relationInfo: RelationInfo;
  transaction: AMTransaction;
  filter?: Record<any, any>;
};

const createAbstractBelongsToRelationOperation = ({
  relationInfo,
  transaction,
}: CreateRelationOperationParams) => {
  const batch = new Batch<DBRef>();

  const relationOperation = new AMReadDBRefOperation(transaction, {
    many: true,
    dbRefList: batch,
  });

  const resolve = async parent => {
    const ref = parent[relationInfo.storeField];
    if (Array.isArray(ref)) {
      batch.addIds(ref);
    } else {
      batch.addId(ref);
    }
    await batch.getPromise();

    const dataMap = await relationOperation.getOutput().getPromise();
    if (Array.isArray(ref)) {
      return ref.map(ref => ({
        ...dataMap[ref.namespace][ref.oid.toHexString()],
        mmCollectionName: ref.namespace,
      }));
    } else {
      return {
        ...dataMap[ref.namespace][ref.oid.toHexString()],
        mmCollectionName: ref.namespace,
      };
    }
  };

  return { relationOperation, resolve };
};

const createBelongsToRelationOperation = ({
  relationInfo,
  transaction,
  filter,
}: CreateRelationOperationParams) => {
  const batch = new Batch();

  const relationOperation = new AMReadOperation(transaction, {
    many: true,
    collectionName: relationInfo.collection,
    fieldsSelection: new AMFieldsSelectionContext([relationInfo.relationField]),
    selector: new AMSelectorContext({
      ...(filter ? { $and: [filter] } : {}),
      [relationInfo.relationField]: {
        $in: batch,
      },
    }),
  });

  relationOperation.addTransformation(
    new ResultPromiseTransforms.IndexBy({
      groupingField: relationInfo.relationField,
    })
  );

  const resolve = async parent => {
    const ids = parent[relationInfo.storeField];
    if (relationInfo.many) {
      batch.addIds(ids);
    } else {
      batch.addId(ids);
    }
    await batch.getPromise();

    const dataMap = await relationOperation.getOutput().getPromise();
    if (relationInfo.many) {
      return ids?.map(id => dataMap[id]).filter(Boolean) ?? [];
    } else {
      return dataMap[ids];
    }
  };

  return { relationOperation, resolve };
};

const createHasRelationOperation = ({
  relationInfo,
  transaction,
  filter,
}: CreateRelationOperationParams) => {
  const batch = new Batch();

  const relationOperation = new AMReadOperation(transaction, {
    many: true,
    collectionName: relationInfo.collection,
    fieldsSelection: new AMFieldsSelectionContext([relationInfo.storeField]),
    selector: new AMSelectorContext({
      ...(filter ? { $and: [filter] } : {}),
      [relationInfo.storeField]: {
        $in: batch,
      },
    }),
  });

  relationOperation.addTransformation(
    new ResultPromiseTransforms.GroupBy({
      groupingField: relationInfo.storeField,
    })
  );

  const resolve = async parent => {
    const id = parent[relationInfo.relationField];
    batch.addId(id);
    await batch.getPromise();

    const dataMap = await relationOperation.getOutput().getPromise();
    if (relationInfo.many) {
      return dataMap[id] ?? [];
    } else {
      return dataMap[id]?.[0];
    }
  };

  return { relationOperation, resolve };
};

const createHasAggregateRelationOperation = ({
  relationInfo,
  transaction,
  filter,
}: CreateRelationOperationParams) => {
  const batch = new Batch();

  const relationOperation = new AMAggregateOperation(transaction, {
    many: true,
    collectionName: relationInfo.collection,
    fieldsSelection: new AMFieldsSelectionContext(['totalCount']),
    selector: new AMSelectorContext({
      ...(filter ? { $and: [filter] } : {}),
      [relationInfo.storeField]: {
        $in: batch,
      },
    }),
  });
  relationOperation.groupBy = relationInfo.storeField;

  relationOperation.addTransformation(
    new ResultPromiseTransforms.IndexBy({
      groupingField: relationInfo.storeField,
    })
  );

  const resolve = async parent => {
    const id = parent[relationInfo.relationField];
    batch.addId(id);
    await batch.getPromise();

    const dataMap = await relationOperation.getOutput().getPromise();
    return dataMap[id].count;
  };

  return { relationOperation, resolve };
};

const createReadOperation = ({
  relationInfo,
  transaction,
  filter,
}: CreateRelationOperationParams) => {
  const relationOperation = new AMReadOperation(transaction, {
    many: true,
    collectionName: relationInfo.collection,
    fieldsSelection: new AMFieldsSelectionContext([]),
    selector: new AMSelectorContext({
      ...(filter ? { $and: [filter] } : {}),
    }),
  });

  const resolve = async () => {
    return relationOperation.getOutput().getPromise();
  };

  return { relationOperation, resolve };
};

const createAggregateOperation = ({
  relationInfo,
  transaction,
  filter,
}: CreateRelationOperationParams) => {
  const relationOperation = new AMAggregateOperation(transaction, {
    many: true,
    collectionName: relationInfo.collection,
    fieldsSelection: new AMFieldsSelectionContext([]),
    selector: new AMSelectorContext({
      ...(filter ? { $and: [filter] } : {}),
    }),
  });

  const resolve = async () => {
    return (await relationOperation.getOutput().getPromise())?.[0]?.count ?? 0;
  };

  return { relationOperation, resolve };
};

const getExistingOperation = ({
  args,
  rootOperation,
  childDataPath,
}: {
  args?: FieldNode['arguments'];
  rootOperation: AMOperation;
  childDataPath: Path;
}) => {
  const existingOperations =
    rootOperation.relationOperations.get(childDataPath.asString()) || [];

  const fieldArgs = args || [];
  for (const op of existingOperations) {
    if (sameArguments(fieldArgs, op.args)) {
      return op;
    }
  }
  return { relationOperation: undefined, resolve: undefined };
};
