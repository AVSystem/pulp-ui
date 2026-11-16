import {
  AlertActionCloseButton,
  type AlertProps,
} from '@patternfly/react-core';
import { type ReactNode } from 'react';
import { Alert } from 'src/components';
import './alert-list.scss';

interface IProps {
  /** List of alerts to display */
  alerts: AlertType[];

  /** Callback to close the alert at the given index */
  closeAlert: (alertIndex) => void;
}

export interface AlertType {
  id?: string;
  variant: AlertProps['variant'];
  title: string | ReactNode;
  description?: string | ReactNode;
}

export const AlertList = ({ alerts, closeAlert }: IProps) => (
  <div className='pulp-alert-list' data-cy='AlertList'>
    {alerts.map((alert, i) => (
      <Alert
        style={{ marginBottom: '16px' }}
        key={i}
        title={alert.title}
        variant={alert.variant}
        isLiveRegion={alert.variant === 'danger'}
        actionClose={<AlertActionCloseButton onClose={() => closeAlert(i)} />}
      >
        {alert.description}
      </Alert>
    ))}
  </div>
);

export function closeAlert(alertIndex, { alerts, setAlerts }) {
  const newList = [...alerts];
  newList.splice(alertIndex, 1);
  setAlerts(newList);
}
