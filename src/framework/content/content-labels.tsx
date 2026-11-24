import { t } from '@lingui/core/macro';
import { Button, Modal, ModalBody, ModalHeader } from '@patternfly/react-core';
import PencilAltIcon from '@patternfly/react-icons/dist/esm/icons/pencil-alt-icon';
import { useId, useState } from 'react';
import { useAppContext } from 'src/app-context';
import type { ContentEntity } from 'src/entities/plugin/content';
import { LabelChips } from '../labels/label-chips';
import { LabelEditor } from '../labels/label-editor';

// The permission that changes the labels of content. Content is shared between
// repositories, so the permission is held on every unit and never on one
// repository.
export const MANAGE_CONTENT_LABELS = 'core.manage_content_labels';

interface Props {
  // The unit, with the labels the server holds for it now.
  row: {
    pulp_href: string;
    pulp_labels?: Record<string, string | null> | null;
  };
  // What names the unit to the user, for the button's name and the dialog.
  name: string;
  entity: ContentEntity<unknown>;
}

// The labels of one unit of content as chips and, for a user who may manage
// content labels, a button that opens the editor in a dialog. A label belongs
// to the unit and not to the repository the list shows it in, so the dialog
// says so. The editor reads the labels from the row, which the list reads again
// once the server has made a change.
export const ContentLabels = ({ row, name, entity }: Props) => {
  const { hasPermission } = useAppContext();
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const { setLabel, unsetLabel } = entity;
  const editable =
    setLabel && unsetLabel && hasPermission(MANAGE_CONTENT_LABELS)
      ? { app: entity.app, object: entity.object, setLabel, unsetLabel }
      : null;

  return (
    <>
      <LabelChips labels={row.pulp_labels} />
      {editable ? (
        <Button
          variant='plain'
          aria-label={t`Edit labels of ${name}`}
          icon={<PencilAltIcon />}
          onClick={() => setOpen(true)}
        />
      ) : null}
      {editable && open ? (
        <Modal
          aria-labelledby={labelId}
          isOpen
          onClose={() => setOpen(false)}
          variant='small'
        >
          <ModalHeader labelId={labelId} title={t`Labels of ${name}`} />
          <ModalBody>
            <p>
              {t`Labels belong to the content unit and show in every repository that holds it.`}
            </p>
            <LabelEditor
              object={row}
              entity={editable}
              canEdit
              initiallyEditing
              onDone={() => setOpen(false)}
            />
          </ModalBody>
        </Modal>
      ) : null}
    </>
  );
};
