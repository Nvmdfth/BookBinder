/**
 * Content fixtures.
 *
 * A design review of an app with three books in it reviews the wrong app:
 * empty states flatter a layout, and the failures worth seeing — wrapped
 * titles, crowded grids, long shelf descriptions — only appear once there is
 * enough in the catalogue to strain it. The titles below are real books with
 * real metadata for the same reason.
 */
const { request } = require('@playwright/test');
const { resolveBaseUrl } = require('./lanHost');

const SHELVES = [
  {
    name: 'Living Room Shelf',
    description: 'The good hardbacks, arranged by spine colour because I am shallow.',
  },
  {
    name: 'Study — Reference',
    description: 'Dictionaries, atlases, and three copies of the same style guide.',
  },
  {
    name: 'Paperback Overflow',
    description: 'Boxes in the loft, catalogued in hope.',
  },
];

const BOOKS = [
  { shelf: 0, isbn: '9780571225385', title: 'The Sea', author: 'John Banville', publisher: 'Faber & Faber', pageCount: 264, publicationDate: '2005-06-02', physicalLocation: 'Row 1, left', notes: 'Booker year. Reread the first chapter.' },
  { shelf: 0, isbn: '9780099470434', title: 'Never Let Me Go', author: 'Kazuo Ishiguro', publisher: 'Faber & Faber', pageCount: 282, publicationDate: '2005-03-03', physicalLocation: 'Row 1, middle' },
  { shelf: 0, isbn: '9780141036144', title: 'Nineteen Eighty-Four', author: 'George Orwell', publisher: 'Penguin', pageCount: 336, publicationDate: '2008-07-29', physicalLocation: 'Row 2' },
  { shelf: 0, isbn: '9780316769488', title: 'The Catcher in the Rye', author: 'J. D. Salinger', publisher: 'Little, Brown', pageCount: 214, publicationDate: '1991-05-01', physicalLocation: 'Row 2' },
  { shelf: 0, isbn: '9781784873677', title: 'Klara and the Sun', author: 'Kazuo Ishiguro', publisher: 'Faber & Faber', pageCount: 320, publicationDate: '2021-03-02' },
  { shelf: 0, isbn: '9780099466031', title: 'Cloud Atlas', author: 'David Mitchell', publisher: 'Sceptre', pageCount: 529, publicationDate: '2004-02-02', notes: 'Lent to Sam, 2019. Never returned.' },
  { shelf: 0, isbn: '9780571334650', title: 'Lincoln in the Bardo', author: 'George Saunders', publisher: 'Bloomsbury', pageCount: 343, publicationDate: '2017-03-07' },
  { shelf: 0, isbn: '9780099273738', title: 'Birdsong', author: 'Sebastian Faulks', publisher: 'Vintage', pageCount: 503, publicationDate: '1994-09-01' },
  { shelf: 0, isbn: '9780007532766', title: 'A Brief History of Seven Killings', author: 'Marlon James', publisher: 'Oneworld', pageCount: 686, publicationDate: '2015-06-04' },
  { shelf: 0, isbn: '9781408891384', title: 'Girl, Woman, Other', author: 'Bernardine Evaristo', publisher: 'Hamish Hamilton', pageCount: 464, publicationDate: '2019-05-02' },
  { shelf: 1, isbn: '9780198611868', title: 'The Concise Oxford English Dictionary', author: 'Oxford Languages', publisher: 'Oxford University Press', pageCount: 1728, publicationDate: '2011-08-18', physicalLocation: 'Top shelf' },
  { shelf: 1, isbn: '9780226287058', title: 'The Chicago Manual of Style', author: 'University of Chicago Press Editorial Staff', publisher: 'University of Chicago Press', pageCount: 1146, publicationDate: '2017-09-05', physicalLocation: 'Top shelf', notes: 'Three copies. Nobody knows why.' },
  { shelf: 1, isbn: '9780141976150', title: 'The Elements of Eloquence', author: 'Mark Forsyth', publisher: 'Icon Books', pageCount: 208, publicationDate: '2014-09-04' },
];

/** Creates the shelves and books for one account. Returns the shelf ids in order. */
async function seedLibrary({ email, password }) {
  const api = await request.newContext({ baseURL: resolveBaseUrl() });

  try {
    const login = await api.post('/api/auth/login', { data: { email, password } });
    if (!login.ok()) throw new Error(`seed login failed: ${login.status()}`);

    const shelfIds = [];
    for (const shelf of SHELVES) {
      const res = await api.post('/api/bookshelves', { data: shelf });
      if (!res.ok()) throw new Error(`shelf "${shelf.name}" failed: ${res.status()}`);
      const body = await res.json();
      shelfIds.push(body.bookshelf?.id ?? body.id);
    }

    for (const book of BOOKS) {
      const { shelf, ...fields } = book;
      const res = await api.post('/api/books/manual', {
        data: { ...fields, bookshelfId: shelfIds[shelf] },
      });
      if (!res.ok()) throw new Error(`book "${book.title}" failed: ${res.status()}`);
    }

    return shelfIds;
  } finally {
    await api.dispose();
  }
}

module.exports = { seedLibrary, SHELVES, BOOKS };
