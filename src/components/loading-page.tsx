import { PageSection, Skeleton, Title } from '@patternfly/react-core';
import { LoadingSpinner, Main } from 'src/components';

export const LoadingPage = (_props) => (
  <>
    <PageSection>
      <Title headingLevel='h1'>
        <Skeleton />
      </Title>
    </PageSection>
    <Main>
      <section>
        <LoadingSpinner />
      </section>
    </Main>
  </>
);
