/**
 * The overlay contract.
 *
 * Three dialogs previously hand-rolled their own backdrop and each omitted the
 * same three things — Escape, dialog semantics, and focus management. Now that
 * one shell serves all of them, these assertions are what stops that shell from
 * quietly losing a behaviour again.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '../components/Modal';

describe('Modal', () => {
  it('announces itself as a dialog labelled by its own title', () => {
    render(<Modal onClose={() => {}} title="Construct Bookshelf">body</Modal>);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Construct Bookshelf');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="Share Console">body</Modal>);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="Share Console">body</Modal>);

    await userEvent.click(screen.getByText('body'));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(document.querySelector('[role="presentation"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses to dismiss while a request is in flight', async () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} title="Saving" busy>body</Modal>);

    await userEvent.keyboard('{Escape}');
    await userEvent.click(document.querySelector('[role="presentation"]'));

    // Dismissing mid-save would strand the request it belongs to
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog', async () => {
    render(
      <Modal onClose={() => {}} title="Edit">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>
    );

    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last' });

    last.focus();
    await userEvent.tab();

    // Wraps back to the top of the dialog rather than escaping to the page
    expect(close).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('returns focus to whatever opened it', async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          {open && <Modal onClose={() => setOpen(false)} title="Card">body</Modal>}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });

    await userEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('still offers a way out when it has no title bar', () => {
    render(<Modal onClose={() => {}}>body</Modal>);

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('locks the page behind it and releases on unmount', () => {
    const { unmount } = render(<Modal onClose={() => {}} title="Card">body</Modal>);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
