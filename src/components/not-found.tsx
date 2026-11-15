import { t } from '@lingui/core/macro';
import { Bullseye, Content } from '@patternfly/react-core';
import { BaseHeader, Main } from 'src/components';
import PulpLogo from 'static/images/pulp_logo.png';
import './not-found.scss';

export const NotFound = () => (
  <>
    <BaseHeader title={t`404 - Page not found`} />
    <Main>
      <section className='pulp-section'>
        <Bullseye className='pulp-c-bullseye'>
          <div className='pulp-c-bullseye__center'>
            <img src={PulpLogo} alt={/* decorative */ ''} />
            <div>{t`We couldn't find the page you're looking for!`}</div>
            <Content>
              <span className='pulp-c-bullseye__404'>404</span>
            </Content>
          </div>
        </Bullseye>
      </section>
    </Main>
  </>
);
