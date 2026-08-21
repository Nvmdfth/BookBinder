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
        json: () => Promise.resolve({ id: 1, name: 'n8n nightly', token: 'bb_secretvalue' }),
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

    await userEvent.type(screen.getByLabelText(/token name/i), 'n8n nightly');
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }));

    expect(await screen.findByText('bb_secretvalue')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(screen.queryByText('bb_secretvalue')).not.toBeInTheDocument());
  });
});
