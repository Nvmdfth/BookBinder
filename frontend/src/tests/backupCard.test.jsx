/**
 * The admin console's backup card.
 *
 * Two properties are worth pinning: a restore cannot be triggered without the
 * typed confirmation (the same string the API demands), and a minted token is
 * displayed once and never returns to the screen afterwards.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BackupCard from '../components/BackupCard';

beforeEach(() => {
  global.fetch = vi.fn((url, options = {}) => {
    if (url === '/api/admin/tokens' && (options.method || 'GET') === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url === '/api/admin/tokens' && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'nightly backup', token: 'bb_secretvalue' }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

afterEach(() => vi.restoreAllMocks());

describe('Restore confirmation', () => {
  it('keeps the restore button disabled until the phrase matches exactly', async () => {
    render(<BackupCard />);

    const button = await screen.findByRole('button', { name: /restore database/i });
    expect(button).toBeDisabled();

    const input = screen.getByLabelText(/type replace_all_data/i);
    await userEvent.type(input, 'replace_all_data');
    expect(button).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'REPLACE_ALL_DATA');

    const file = new File(['archive'], 'backup.dump', { type: 'application/octet-stream' });
    await userEvent.upload(screen.getByLabelText(/backup archive/i), file);

    expect(button).toBeEnabled();
  });

  it('stays disabled with the phrase but no file chosen', async () => {
    render(<BackupCard />);

    const input = screen.getByLabelText(/type replace_all_data/i);
    await userEvent.type(input, 'REPLACE_ALL_DATA');

    expect(screen.getByRole('button', { name: /restore database/i })).toBeDisabled();
  });
});

describe('Avatar exclusion notice', () => {
  it('states that uploads are not in the archive', async () => {
    render(<BackupCard />);

    expect(await screen.findByText(/avatar images are not included/i)).toBeInTheDocument();
  });
});

describe('Token minting', () => {
  it('shows a new token once and not in the list afterwards', async () => {
    render(<BackupCard />);

    await userEvent.type(screen.getByLabelText(/token name/i), 'nightly backup');
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }));

    expect(await screen.findByText('bb_secretvalue')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(screen.queryByText('bb_secretvalue')).not.toBeInTheDocument());
  });
});

describe('Token revocation', () => {
  it('disables the revoke button while the request is in flight, so a double-click cannot 404 after success', async () => {
    let resolveDelete;
    global.fetch = vi.fn((url, options = {}) => {
      if (url === '/api/admin/tokens' && (options.method || 'GET') === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 1, name: 'nightly backup', last_used_at: null, created_at: '2026-01-01' },
          ]),
        });
      }
      if (url === '/api/admin/tokens/1' && options.method === 'DELETE') {
        return new Promise((resolve) => { resolveDelete = resolve; });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<BackupCard />);

    const revokeButton = await screen.findByRole('button', { name: /revoke nightly backup/i });
    await userEvent.click(revokeButton);

    // The first click's DELETE is still pending: the button must already be
    // disabled so a second click cannot fire a request against a token the
    // first request is in the middle of revoking.
    expect(revokeButton).toBeDisabled();

    resolveDelete({ ok: true, json: () => Promise.resolve({ message: 'API token revoked.' }) });
    await waitFor(() => expect(revokeButton).not.toBeDisabled());
  });

  it('surfaces an error and keeps the token listed when the API returns 404', async () => {
    // A 404 (per the documented DELETE contract) must not read as success:
    // the token stays in the list and the failure is shown, not swallowed.
    global.fetch = vi.fn((url, options = {}) => {
      if (url === '/api/admin/tokens' && (options.method || 'GET') === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 1, name: 'nightly backup', last_used_at: null, created_at: '2026-01-01' },
          ]),
        });
      }
      if (url === '/api/admin/tokens/1' && options.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<BackupCard />);

    const revokeButton = await screen.findByRole('button', { name: /revoke nightly backup/i });
    await userEvent.click(revokeButton);

    expect(await screen.findByText(/could not revoke/i)).toBeInTheDocument();
    expect(screen.getByText('nightly backup')).toBeInTheDocument();
  });
});

describe('Banner exclusivity (M10)', () => {
  it('clears a success notice when a later action fails, so both banners never show at once', async () => {
    let backupCallCount = 0;
    global.fetch = vi.fn((url, options = {}) => {
      if (url === '/api/admin/tokens' && (options.method || 'GET') === 'GET') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === '/api/admin/backup') {
        backupCallCount += 1;
        if (backupCallCount === 1) {
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['data'])) });
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'pg_dump failed' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    render(<BackupCard />);
    const downloadButton = await screen.findByRole('button', { name: /download backup/i });

    await userEvent.click(downloadButton);
    expect(await screen.findByText(/backup downloaded/i)).toBeInTheDocument();

    await userEvent.click(downloadButton);
    expect(await screen.findByText(/pg_dump failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/backup downloaded/i)).not.toBeInTheDocument();
  });
});

describe('Copy token feedback (M10)', () => {
  it('reports a failed clipboard write instead of leaving it an unhandled rejection', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    render(<BackupCard />);
    await userEvent.type(screen.getByLabelText(/token name/i), 'nightly backup');
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }));
    await screen.findByText('bb_secretvalue');

    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(await screen.findByText(/could not copy the token/i)).toBeInTheDocument();
  });

  it('reports when the Clipboard API is unavailable (non-secure context)', async () => {
    Object.assign(navigator, { clipboard: undefined });

    render(<BackupCard />);
    await userEvent.type(screen.getByLabelText(/token name/i), 'nightly backup');
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }));
    await screen.findByText('bb_secretvalue');

    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(await screen.findByText(/clipboard access is unavailable/i)).toBeInTheDocument();
  });
});

describe('API endpoint reference', () => {
  it('shows the pull endpoint with the bearer header an automation needs', async () => {
    render(<BackupCard />);

    expect(await screen.findByText(/GET .*\/api\/admin\/backup/)).toBeInTheDocument();
    // Both examples carry it — pulling and pushing use the same credential.
    expect(screen.getAllByText(/Authorization: Bearer bb_/)).toHaveLength(2);
  });

  it('shows the push endpoint with both required multipart fields', async () => {
    render(<BackupCard />);

    expect(await screen.findByText(/POST .*\/api\/admin\/restore/)).toBeInTheDocument();
    // Without the confirm field the endpoint 400s, so a reference that omits it
    // would send the reader straight into a failure.
    expect(screen.getByText(/confirm=REPLACE_ALL_DATA/)).toBeInTheDocument();
    expect(screen.getByText(/file=@/)).toBeInTheDocument();
  });

  it('uses the host the admin is actually on, so the examples are runnable as shown', async () => {
    render(<BackupCard />);

    const pull = await screen.findByText(/GET .*\/api\/admin\/backup/);
    expect(pull.textContent).toContain(window.location.origin);
  });
});
