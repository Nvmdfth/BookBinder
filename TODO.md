Barcode scanner scans too quickly after the first successful scan. Have the user confirm if the book is correct before proceeding. It should be a Yes/No confirmation with the details it pulled from Google Books API. If yes, it should add it to the bookshelf. If no, it should allow the user to try again. 



Implement a "Book Roulette" feature. A user can select this option and it will randomly select a book from their bookshelves that aren't marked as read yet. This is useful for when a user is looking for a book to read but doesn't know what to read. It should display the book cover, title, and author, and ask the user if they want to read it. The button should appear at the top next to "New Bookshelf" on the dashboard. When the button is selected, it will open a modal with the randomly selected book and it's bookshelf location. The user will have the option to "Roll Again". No updates to the database will happen.
