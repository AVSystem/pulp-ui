import { runBounded } from 'src/entities/batch';
import { apiPathOfHref } from 'src/entities/href';
import type { UploadableContent } from 'src/entities/plugin/content';
import type { ModifyBody } from 'src/entities/plugin/repository';
import {
  isSessionEnd,
  requestErrorReason,
  requestErrorText,
} from 'src/utilities/request-error';
import { UPLOAD_LIMITS, type UploadProgress, uploadFile } from './upload-file';

// A file the user chose, with the path they typed for it, if any.
export interface UploadItem {
  file: File;
  relativePath?: string;
}

// How a task the upload waits for has ended. The task reader of the screens
// answers exactly this.
export type TaskEnded =
  | { state: 'completed'; created: string[] }
  | { state: 'failed'; reason: string }
  | { state: 'pending' | 'unknown' | 'unconfirmed' };

export type WaitForTask = (
  task: string,
  options: { signal?: AbortSignal },
) => Promise<TaskEnded>;

// What became of one file.
export type UploadOutcome =
  // The server started the task that makes the file's content and adds it to
  // the repository as a version of its own.
  | { kind: 'started'; task: string }
  // The content exists but is not in the repository yet: it is added together
  // with the other files in one step, when every file has been made.
  | { kind: 'created'; content: string[] }
  // The task ended without naming any content, so there is nothing to add.
  | { kind: 'no-content'; task: string }
  // Refused or failed, with the server's reason.
  | { kind: 'failed'; reason: string }
  // The wait for the task that makes the content was ended before it finished
  // (pending) or the task could not be read (unknown): it may still do its
  // work, but the file is not added.
  | { kind: 'unfinished'; task: string; why: 'pending' | 'unknown' }
  // The caller canceled while the file was on its way.
  | { kind: 'canceled' }
  // Nothing was sent: the caller canceled or the session ended first.
  | { kind: 'not-sent' }
  // The session ended while the file was on its way, so it is not known
  // whether the server took it.
  | { kind: 'unconfirmed' };

export interface UploadResult {
  file: File;
  outcome: UploadOutcome;
}

// What became of the one request that adds the new content to the repository.
export type AddOutcome =
  | { kind: 'started'; task: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'unconfirmed' };

export interface UploadFilesResult {
  // One result per file, in the order of the files.
  results: UploadResult[];
  // Only in the one-version flow, and only when every file was made: the task
  // that adds all the content to the repository.
  add?: AddOutcome;
}

export interface UploadFilesParams {
  items: readonly UploadItem[];
  contentEntity: UploadableContent<unknown>;
  // The repository the content goes into, and the entity that changes it.
  repository: string;
  repositoryEntity: {
    modify?: (
      href: string,
      body: ModifyBody,
      options?: RequestInit,
    ) => Promise<string>;
  };
  // Whether the user may create content without naming a repository. Only a
  // superuser may, and only then do several files make one version.
  superuser: boolean;
  // Whether the user may create uploads.
  mayChunk: boolean;
  waitForTask: WaitForTask;
  signal?: AbortSignal;
  // Called when a chunk of a file has been taken, with the index of the file.
  onProgress?: (index: number, progress: UploadProgress) => void;
  // Called when a file's outcome is known, with the index of the file.
  onSettled?: (index: number, outcome: UploadOutcome) => void;
}

// The reason to show for a request that failed: the server's own words for a
// refused one, the status line for any other.
function reasonOf(error: unknown): string {
  return requestErrorReason(error) ?? requestErrorText(error);
}

// The addresses of content units among what a task created.
function contentOf(created: readonly string[]): string[] {
  return created.filter((href) =>
    (apiPathOfHref(href) ?? '').startsWith('content/'),
  );
}

// Uploads the files and makes their content, and answers what became of each.
//
// A superuser may create content without a repository. Every file is then made
// first, and only when all of them were made does one request add all the new
// content to the repository, so the files together make one new version. If a
// file fails nothing is added: the others stay as content that belongs to no
// repository, and the result says which file failed and why.
//
// Everyone else creates each file with the repository, so every file makes a
// version of its own and one that fails does not stop the others.
//
// The function never rejects for the failure of a file or of the final
// request; each is reported in the result. At most two files are on their way
// at once.
export async function uploadFiles({
  items,
  contentEntity,
  repository,
  repositoryEntity,
  superuser,
  mayChunk,
  waitForTask,
  signal,
  onProgress,
  onSettled,
}: UploadFilesParams): Promise<UploadFilesResult> {
  if (superuser && !repositoryEntity.modify) {
    throw new Error('This kind of repository has no modify request.');
  }
  let sessionEnded = false;

  const send = async (
    { file, relativePath }: UploadItem,
    index: number,
  ): Promise<UploadOutcome> => {
    const task = await uploadFile({
      file,
      contentEntity,
      fields: contentEntity.fieldsOf(file.name, relativePath),
      ...(superuser ? {} : { repository }),
      mayChunk,
      signal,
      onProgress: (progress) => onProgress?.(index, progress),
    });
    if (!superuser) {
      return { kind: 'started', task };
    }

    const ended = await waitForTask(task, { signal });
    if (ended.state === 'completed') {
      const content = contentOf(ended.created);
      return content.length > 0
        ? { kind: 'created', content }
        : { kind: 'no-content', task };
    }
    if (ended.state === 'failed') {
      return { kind: 'failed', reason: ended.reason };
    }
    if (ended.state === 'unconfirmed') {
      return { kind: 'unconfirmed' };
    }
    return { kind: 'unfinished', task, why: ended.state };
  };

  // Never rejects: what went wrong with a file is the file's outcome.
  const settle = async (
    item: UploadItem,
    index: number,
  ): Promise<UploadOutcome> => {
    if (sessionEnded || signal?.aborted) {
      return { kind: 'not-sent' };
    }
    try {
      return await send(item, index);
    } catch (error) {
      if (isSessionEnd(error)) {
        return { kind: 'unconfirmed' };
      }
      return signal?.aborted
        ? { kind: 'canceled' }
        : { kind: 'failed', reason: reasonOf(error) };
    }
  };

  const results = await runBounded(
    items.map((item, index) => ({ item, index })),
    UPLOAD_LIMITS.filesInFlight,
    async ({ item, index }): Promise<UploadResult> => {
      const outcome = await settle(item, index);
      if (outcome.kind === 'unconfirmed') {
        sessionEnded = true;
      }
      onSettled?.(index, outcome);
      return { file: item.file, outcome };
    },
  );

  if (!superuser) {
    return { results };
  }

  // One version for all of them, and only when every file was made.
  const content = new Set<string>();
  for (const { outcome } of results) {
    if (outcome.kind !== 'created') {
      return { results };
    }
    outcome.content.forEach((href) => content.add(href));
  }
  if (results.length === 0) {
    return { results };
  }

  try {
    const task = await repositoryEntity.modify(
      repository,
      { add_content_units: Array.from(content) },
      { signal },
    );
    return { results, add: { kind: 'started', task } };
  } catch (error) {
    return {
      results,
      add: isSessionEnd(error)
        ? { kind: 'unconfirmed' }
        : { kind: 'failed', reason: reasonOf(error) },
    };
  }
}
