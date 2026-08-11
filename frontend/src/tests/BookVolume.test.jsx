/**
 * The bound-volume renderer is what stops a shelf with no cover art from
 * reading as a grid of broken images, so the two things that make it work —
 * always rendering *something* bookish, and binding a given volume the same way
 * every time — are worth pinning down.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BookVolume from '../components/BookVolume';
import { clothFor, CLOTHS } from '../utils/binding';

describe('BookVolume', () => {
  it('typesets the title onto a binding when no cover art is on file', () => {
    const { container } = render(<BookVolume title="Piranesi" author="Susanna Clarke" />);

    expect(screen.getByText('Piranesi')).toBeInTheDocument();
    expect(screen.getByText('Susanna Clarke')).toBeInTheDocument();
    // The board groove is what makes it read as a bound book rather than a swatch
    expect(container.querySelector('.volume-board')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('drops a real cover into the same frame when one exists', () => {
    const { container } = render(
      <BookVolume title="Dune" coverUrl="http://example.test/dune.jpg" />
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('http://example.test/dune.jpg');
    // No binding furniture behind an actual cover
    expect(container.querySelector('.volume-board')).toBeNull();
  });

  it('binds a given volume identically every time', () => {
    // A shelf that reshuffled its colours on each render would look like a
    // rendering fault, not a library
    expect(clothFor('978-0-441-17271-9')).toBe(clothFor('978-0-441-17271-9'));
    expect(CLOTHS).toContain(clothFor('978-0-441-17271-9'));
  });

  it('spreads different volumes across more than one cloth', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `978-0-000-0000${i}-0`);
    const used = new Set(seeds.map(clothFor));

    expect(used.size).toBeGreaterThan(1);
  });

  it('marks a read volume without depending on the caption below it', () => {
    const { container } = render(<BookVolume title="The Peregrine" isRead />);

    expect(container.querySelector('.volume-read')).not.toBeNull();
  });
});
