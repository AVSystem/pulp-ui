import { t } from '@lingui/core/macro';
import { Divider, DropdownItem } from '@patternfly/react-core';
import LanguageIcon from '@patternfly/react-icons/dist/esm/icons/language-icon';
import { StatefulDropdown } from 'src/components';
import { availableLanguages, language, languageNames } from 'src/l10n';

// Shown only when there is a choice to make.
export function LanguageSwitcher(_props) {
  if (availableLanguages.length < 2) {
    return null;
  }

  const currentLanguage = languageNames[language] || language;

  return (
    <StatefulDropdown
      ariaLabel={t`Select language`}
      data-cy='language-dropdown'
      toggleClassName='pulp-topbar__button'
      defaultText={<LanguageIcon />}
      toggleType='icon'
      items={[
        <DropdownItem isDisabled key='current'>
          {window.localStorage.override_l10n
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
        <DropdownItem
          key='unset'
          to='?lang='
          isDisabled={!window.localStorage.override_l10n}
        >
          {t`Reset to browser defaults`}
        </DropdownItem>,
      ]}
    />
  );
}
