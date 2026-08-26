/**
 * app.js
 * ---------------------------------------------------------------------
 * Home page behavior: clicking a cuisine category card jumps straight
 * to the generator with that cuisine pre-selected via a query param.
 */

document.querySelectorAll('.category-card').forEach((card) => {
  card.addEventListener('click', () => {
    const cuisine = card.getAttribute('data-cuisine');
    window.location.href = `generator.html?cuisine=${encodeURIComponent(cuisine)}`;
  });
});
