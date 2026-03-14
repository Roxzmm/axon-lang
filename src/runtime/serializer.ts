import { AxonValue, ValueTag, mkInt, mkFloat, mkString, mkBool, mkList, mkTuple, mkRecord, mkEnum, UNIT, TRUE, FALSE } from './value';

export function serializeAxonValue(value: AxonValue): any {
  switch (value.tag) {
    case ValueTag.Int:
      return { tag: ValueTag.Int, value: value.value.toString() };
    case ValueTag.Float:
      return { tag: ValueTag.Float, value: value.value };
    case ValueTag.Bool:
      return { tag: ValueTag.Bool, value: value.value };
    case ValueTag.String:
      return { tag: ValueTag.String, value: value.value };
    case ValueTag.Char:
      return { tag: ValueTag.Char, value: value.value };
    case ValueTag.Unit:
      return { tag: ValueTag.Unit };
    case ValueTag.List:
      return { tag: ValueTag.List, items: value.items.map(serializeAxonValue) };
    case ValueTag.Tuple:
      return { tag: ValueTag.Tuple, items: value.items.map(serializeAxonValue) };
    case ValueTag.Record: {
      const fields: Record<string, any> = {};
      for (const [k, v] of value.fields.entries()) {
        fields[k] = serializeAxonValue(v);
      }
      return { tag: ValueTag.Record, typeName: value.typeName, fields };
    }
    case ValueTag.Enum: {
      const recordFields: Record<string, any> = {};
      for (const [k, v] of value.recordFields.entries()) {
        recordFields[k] = serializeAxonValue(v);
      }
      return {
        tag: ValueTag.Enum,
        typeName: value.typeName,
        variant: value.variant,
        fields: value.fields.map(serializeAxonValue),
        recordFields
      };
    }
    case ValueTag.Function:
    case ValueTag.NativeFn:
    case ValueTag.AsyncNativeFn:
    case ValueTag.Agent:
    case ValueTag.Channel:
      throw new Error(`Cannot serialize value of type ${value.tag}`);
    case ValueTag.Never:
      return { tag: ValueTag.Never };
  }
}

export function deserializeAxonValue(data: any): AxonValue {
  switch (data.tag) {
    case ValueTag.Int:
      return mkInt(BigInt(data.value));
    case ValueTag.Float:
      return mkFloat(data.value);
    case ValueTag.Bool:
      return mkBool(data.value);
    case ValueTag.String:
      return mkString(data.value);
    case ValueTag.Char:
      return { tag: ValueTag.Char, value: data.value };
    case ValueTag.Unit:
      return UNIT;
    case ValueTag.List:
      return mkList(data.items.map(deserializeAxonValue));
    case ValueTag.Tuple:
      return mkTuple(data.items.map(deserializeAxonValue));
    case ValueTag.Record: {
      const fields: Record<string, AxonValue> = {};
      for (const [k, v] of Object.entries(data.fields)) {
        fields[k] = deserializeAxonValue(v);
      }
      return mkRecord(data.typeName, fields);
    }
    case ValueTag.Enum: {
      const recordFields: Record<string, AxonValue> = {};
      for (const [k, v] of Object.entries(data.recordFields)) {
        recordFields[k] = deserializeAxonValue(v);
      }
      return mkEnum(data.typeName, data.variant, data.fields.map(deserializeAxonValue), recordFields);
    }
    case ValueTag.Never:
      return { tag: ValueTag.Never };
    default:
      throw new Error(`Unknown tag ${data.tag} in deserialization`);
  }
}
