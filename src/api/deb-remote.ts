import { PulpAPI } from './pulp';

export interface DebRemoteType {
  architectures: string;
  ca_cert: string;
  client_cert: string;
  components: string;
  distributions: string;
  download_concurrency: number;
  gpgkey: string;
  ignore_missing_package_indices?: boolean;
  max_retries?: number | null;
  name: string;
  policy?: string;
  proxy_url: string;
  pulp_href?: string;
  rate_limit: number;
  sync_installer?: boolean;
  sync_sources?: boolean;
  sync_udebs?: boolean;
  tls_validation: boolean;
  total_timeout?: number | null;
  url: string;

  // connect_timeout
  // headers
  // prn
  // pulp_created
  // pulp_labels
  // pulp_last_updated
  // sock_connect_timeout
  // sock_read_timeout

  hidden_fields: {
    is_set: boolean;
    name: string;
  }[];

  my_permissions?: string[];
}

const base = new PulpAPI();

export const DebRemoteAPI = {
  list: (params?) => base.list(`remotes/deb/apt/`, params),
};
