import { t } from '@lingui/core/macro';
import { Divider, DropdownItem } from '@patternfly/react-core';
import LanguageIcon from '@patternfly/react-icons/dist/esm/icons/language-icon';
import { type ReactElement } from 'react';
import { StatefulDropdown } from 'src/components';
import { availableLanguages, language, languageNames } from 'src/l10n';
import { readStored } from 'src/utilities/safe-storage';

// The menu entries that choose the language: the current one, every language
// the interface comes in, and the way back to the browser's own choice. Empty
// when there is no choice to make.
export function languageMenuItems(): ReactElement[] {
  if (availableLanguages.length < 2) {
    return [];
  }

  const currentLanguage = languageNames[language] || language;
  const overridden = !!readStored('override_l10n');

  return [
    <DropdownItem isDisabled key='current'>
      {overridden
        ? t`${currentLanguage} (current)`
        : t`${currentLanguage} (browser default)`}
    </DropdownItem>,
    <Divider component='li' key='separator1' />,
    ...availableLanguages.map((lang) => (
      <DropdownItem
        key={lang}
        to={`?lang=${lang}`}
        isDisabled={lang === language}
      >
        {languageNames[lang] || lang}
      </DropdownItem>
    )),
    <Divider component='li' key='separator2' />,
    <DropdownItem key='unset' to='?lang=' isDisabled={!overridden}>
      {t`Reset to browser defaults`}
    </DropdownItem>,
  ];
}

// Shown only when there is a choice to make.
export function LanguageSwitcher(_props) {
  const items = languageMenuItems();

  if (items.length === 0) {
    return null;
  }

  return (
    <StatefulDropdown
      ariaLabel={t`Select language`}
      data-cy='language-dropdown'
      toggleClassName='pulp-topbar__button'
      defaultText={<LanguageIcon />}
      toggleType='icon'
      items={items}
    />
  );
}
