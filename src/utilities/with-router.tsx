import { useLocation, useNavigate, useParams } from 'react-router';
import { useSessionEpoch } from '../user-context';
import { ParamHelper } from './param-helper';

// compatibility layer between react-router v6 and class components

// differences from v5:
// history.push -> navigate
// location -> location
// match.params -> routeParams

export class RouteProps {
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  routeParams: Record<string, string>;
  // Grows each time the same user signs in again after the session ended,
  // so a screen can read its data again.
  sessionEpoch: number;
}

export const withRouter = (ClassComponent) => {
  const WithRouter = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const params = useParams();
    const sessionEpoch = useSessionEpoch();

    return (
      <ClassComponent
        location={location}
        navigate={navigate}
        routeParams={params}
        sessionEpoch={sessionEpoch}
      />
    );
  };

  WithRouter.displayName = `withRouter(${
    ClassComponent.displayName || ClassComponent.name
  })`;

  return WithRouter;
};

export function useQueryParams(): Record<string, string> {
  const location = useLocation();
  return ParamHelper.parseParamString(location.search);
}
