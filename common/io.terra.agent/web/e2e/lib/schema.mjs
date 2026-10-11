// 계약(terra-api.json)이 쓰는 JSON Schema 부분집합 검증기 — 가짜 서버의 응답을 계약의 output 스키마에 대조하는 데만 쓴다.
// 지원: type(string·integer·number·boolean·object·array) · enum · required · properties · additionalProperties:false ·
//       items · minLength · maxLength · pattern · minimum · maximum. 그 밖의 키워드는 무시한다(계약이 쓰지 않는다).

export function validate(schema, value, at = '') {
  const errors = [];
  const fail = (kind, message) => errors.push({ at: at || '/', kind, message });
  if (schema.type) {
    const ok = {
      string: typeof value === 'string',
      integer: Number.isInteger(value),
      number: typeof value === 'number',
      boolean: typeof value === 'boolean',
      object: value !== null && typeof value === 'object' && !Array.isArray(value),
      array: Array.isArray(value),
    }[schema.type];
    if (!ok) {
      fail('type', `${schema.type} 여야 하는데 ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) fail('enum', `${JSON.stringify(value)} 는 ${JSON.stringify(schema.enum)} 에 없다`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail('minLength', `길이 ${value.length} < ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('maxLength', `길이 ${value.length} > ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('pattern', `${JSON.stringify(value)} 가 ${schema.pattern} 에 안 맞다`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail('minimum', `${value} < ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail('maximum', `${value} > ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => errors.push(...validate(schema.items, item, `${at}/${index}`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) fail('required', `필수 필드 ${key} 가 없다`);
    for (const [key, child] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(sub, child, `${at}/${key}`));
      else if (schema.additionalProperties === false) errors.push({ at: `${at}/${key}`, kind: 'additionalProperties', message: `계약에 없는 필드 ${key}` });
    }
  }
  return errors;
}
