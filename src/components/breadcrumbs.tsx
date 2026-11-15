import { BreadcrumbItem } from '@patternfly/react-core';
import { Link } from 'react-router';
import { Breadcrumb } from 'src/components';
import { usePhoneWidth } from 'src/utilities/use-phone-width';

export interface BreadcrumbType {
  name: string;
  url?: string;
}

interface IProps {
  /** List of links to display in the breadcrumb */
  links: BreadcrumbType[];
}

// The crumb that leads one level up: the nearest earlier crumb with a link.
function parentOf(links: BreadcrumbType[]): BreadcrumbType | undefined {
  return links
    .slice(0, -1)
    .reverse()
    .find((link) => link.url);
}

export const Breadcrumbs = ({ links }: IProps) => {
  const phone = usePhoneWidth();
  const last = links.length - 1;
  const parent = parentOf(links);

  const crumb = (link: BreadcrumbType, index: number) => (
    <BreadcrumbItem
      key={index}
      className='pulp-crumb'
      isActive={index === last}
    >
      {link.url && index !== last ? (
        <Link to={link.url} title={link.name}>
          {link.name}
        </Link>
      ) : (
        <span className='pulp-crumb__text' title={link.name}>
          {link.name}
        </span>
      )}
    </BreadcrumbItem>
  );

  const shown =
    phone && last > 0
      ? [
          ...(parent
            ? [
                <BreadcrumbItem key='parent' className='pulp-crumb'>
                  <Link
                    to={parent.url as string}
                    title={parent.name}
                    aria-label={parent.name}
                  >
                    ...
                  </Link>
                </BreadcrumbItem>,
              ]
            : []),
          crumb(links[last], last),
        ]
      : links.map(crumb);

  return <Breadcrumb className='pulp-crumbs'>{shown}</Breadcrumb>;
};
