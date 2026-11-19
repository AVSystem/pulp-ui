type FormValue = string | number | boolean | Blob | object | null | undefined;

const isBlob = (value: unknown): value is Blob => value instanceof Blob;

/**
 * Turns one value into the text or file a multipart field carries. A file
 * (Blob or File) is sent as it is; any other object is sent as JSON text, which
 * is how Pulp reads a structured field of a multipart body.
 * @param {Exclude<FormValue, null | undefined>} value Field value.
 * @returns {string | Blob} The multipart part.
 */
function toPart(value: Exclude<FormValue, null | undefined>): string | Blob {
  if (isBlob(value)) {
    return value;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Builds the multipart body of a request from an object. Fields that are
 * undefined or null are left out; a list is sent as repeated fields.
 * @param {Record<string, FormValue | FormValue[]>} body Request body object.
 * @returns {FormData} Multipart body.
 */
function pulpFormData(body: object): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(
    body as Record<string, FormValue | FormValue[]>,
  )) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) {
        formData.append(name, toPart(item));
      }
    }
  }
  return formData;
}

export { pulpFormData };
