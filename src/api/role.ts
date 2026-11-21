import { config } from 'src/ui-config';
import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const RoleAPI = {
  list: (params?, for_object_type?) => {
    const newParams = { ...params };
    if (for_object_type) {
      // ?for_object_type=/pulp/api/v3/.../
      // list visible in http://localhost:8002/pulp/api/v3/
      newParams.for_object_type = `${config.API_BASE_PATH}${for_object_type}/`;
    }
    return base.list(`roles/`, newParams);
  },
};
