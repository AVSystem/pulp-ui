import { css } from '@patternfly/react-styles';
import tabsStyles from '@patternfly/react-styles/css/components/Tabs/tabs.mjs';
import { type ReactNode } from 'react';
import { Link } from 'react-router';

export interface LinkTabsProps {
  /** List of tabs */
  tabs: {
    active?: boolean;
    link: string;
    title: string;
    icon?: ReactNode;
  }[];
}

const renderTab = ({ link, title, icon = null, active = false }) => (
  <li
    className={css(tabsStyles.tabsItem, active && tabsStyles.modifiers.current)}
    key={title}
  >
    <Link
      to={link}
      className={tabsStyles.tabsLink}
      aria-current={active ? 'page' : undefined}
    >
      <span className={tabsStyles.tabsItemText}>
        {icon ? <>{icon} </> : null}
        {title}
      </span>
    </Link>
  </li>
);

// We're not using the Tab react component because they don't support links.
export const LinkTabs = ({ tabs }: LinkTabsProps) => (
  <div className={tabsStyles.tabs}>
    <ul className={tabsStyles.tabsList}>
      {tabs.filter(Boolean).map((tab) => renderTab(tab))}
    </ul>
  </div>
);
