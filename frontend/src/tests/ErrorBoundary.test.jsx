/**
 * Without a boundary React unmounts the whole tree on a thrown render, which is
 * how a single bad property access becomes a blank white screen carrying no
 * information at all — the failure mode reported from a phone, where there is
 * no console to inspect.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

function Boom() {
  throw new Error("Failed to execute 'removeChild' on 'Node'");
}

describe('ErrorBoundary', () => {
  let errorSpy;

  beforeEach(() => {
    // React logs the caught error; silencing keeps the run readable
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>shelf contents</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('shelf contents')).toBeInTheDocument();
  });

  it('keeps the page standing and names the error instead of going blank', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/something broke on this screen/i)).toBeInTheDocument();
    // The message is the whole point: a blank screen is unreportable
    expect(screen.getByText(/removeChild/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('reassures that saved work survived, since the write usually landed first', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/anything already saved was saved/i)).toBeInTheDocument();
  });
});
