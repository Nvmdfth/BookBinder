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

  it('focuses the first field in the body, not the close button', () => {
    // Close precedes the body in document order, so a panel-wide querySelector
    // lands on it. Nobody opens a form in order to focus Close.
    render(
      <Modal onClose={() => {}} title="Construct Bookshelf">
        <input aria-label="Bookshelf Name" />
      </Modal>
    );

    expect(screen.getByRole('textbox', { name: 'Bookshelf Name' })).toHaveFocus();
  });

  it('falls back to the panel when the body has nothing focusable', () => {
    render(<Modal onClose={() => {}} title="Drawing…">Loading</Modal>);

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('does not steal focus when the parent re-renders', async () => {
    /*
     * The regression this file previously missed. Callers pass inline arrows
     * for onClose, so its identity changes on every parent render — and a
     * controlled input re-renders the parent on every keystroke. With onClose
     * in the effect deps, each character tore the dialog down and rebuilt it:
     * focus snapped to Close, and typing a name with a space in it then
     * activated Close and dismissed the whole dialog.
     */
    function Harness() {
      const [name, setName] = React.useState('');
      const [open, setOpen] = React.useState(true);
      return open ? (
        <Modal onClose={() => setOpen(false)} title="Construct Bookshelf">
          <input
            aria-label="Bookshelf Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Modal>
      ) : null;
    }

    render(<Harness />);
    const field = screen.getByRole('textbox', { name: 'Bookshelf Name' });

    await userEvent.type(field, 'Living Room Case A');

    expect(field).toHaveFocus();
    expect(field).toHaveValue('Living Room Case A');
    // The space must not have reached a focused Close button
    expect(screen.getByRole('dialog')).toBeInTheDocument();
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
