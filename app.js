/**
 * CinéMatch — Application Mobile-First
 * Connectée aux données réelles de Toulourama (Pathé) & IMDb (OMDb API)
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'cinematch_preferences_v1';
  const CINEMA_STORAGE_PREFIX = 'cinematch_db_';
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4PUen42hiYlpHtgSKwAzJYEtHj-LHoCFbC8un1R_NfAFb7wA3CwmQzqtgd9l2ou7Z/exec';
  const OMDB_API_KEY = 'cd47ed88';

  function getYouTubeTrailerSearchUrl(movie) {
    const currentYear = new Date().getFullYear(); // 2026
    let queryParts = [movie.title];
    if (movie.director && movie.director.trim()) {
      queryParts.push(movie.director.trim());
    }
    queryParts.push("Bande annonce");
    queryParts.push(currentYear);
    const queryString = queryParts.join(" ");
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(queryString)}`;
  }

  function openTrailer(movie) {
    const url = getYouTubeTrailerSearchUrl(movie);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function getGoogleRatingSearchUrl(movie) {
    let queryParts = [movie.title];
    if (movie.director && movie.director.trim()) {
      queryParts.push(movie.director.trim());
    }
    queryParts.push("note avis");
    const queryString = queryParts.join(" ");
    return `https://www.google.com/search?q=${encodeURIComponent(queryString)}`;
  }

  function openGoogleRating(movie) {
    const url = getGoogleRatingSearchUrl(movie);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ==========================================================================
  // Client-Side OMDb API Fetcher (auto-enrichit directement dans le navigateur)
  // ==========================================================================
  async function fetchOmdbDetailsClientSide(movie) {
    try {
      const cleanTitle = movie.title.replace(/[\u2019\']/g, "'").split(':')[0].trim();
      const url = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(cleanTitle)}&plot=full`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.Response === 'True') {
        return {
          imdb_id: data.imdbID || '',
          rating: data.imdbRating && data.imdbRating !== 'N/A' ? data.imdbRating : null,
          votes: data.imdbVotes && data.imdbVotes !== 'N/A' ? data.imdbVotes : null,
          plot_en: data.Plot && data.Plot !== 'N/A' ? data.Plot : '',
          poster: data.Poster && data.Poster !== 'N/A' ? data.Poster : '',
          actors: data.Actors && data.Actors !== 'N/A' ? data.Actors : '',
          year: data.Year || ''
        };
      }

      // Recherche par mot-clé de secours si le titre exact ne répond pas
      const searchUrl = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&s=${encodeURIComponent(cleanTitle)}`;
      const sRes = await fetch(searchUrl);
      const sData = await sRes.json();
      if (sData && sData.Response === 'True' && sData.Search && sData.Search.length > 0) {
        const firstMatch = sData.Search[0];
        const detailUrl = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${firstMatch.imdbID}&plot=full`;
        const dRes = await fetch(detailUrl);
        const dData = await dRes.json();
        if (dData && dData.Response === 'True') {
          return {
            imdb_id: dData.imdbID || '',
            rating: dData.imdbRating && dData.imdbRating !== 'N/A' ? dData.imdbRating : null,
            votes: dData.imdbVotes && dData.imdbVotes !== 'N/A' ? dData.imdbVotes : null,
            plot_en: dData.Plot && dData.Plot !== 'N/A' ? dData.Plot : '',
            poster: dData.Poster && dData.Poster !== 'N/A' ? dData.Poster : '',
            actors: dData.Actors && dData.Actors !== 'N/A' ? dData.Actors : '',
            year: dData.Year || ''
          };
        }
      }
    } catch (e) {
      console.warn("Erreur OMDb client-side:", e);
    }
    return null;
  }

  // ==========================================================================
  // État de l'application & LocalStorage
  // ==========================================================================
  const state = {
    selectedCinema: localStorage.getItem('cinematch_current_cinema') || 'pathe',
    liked: new Set(),
    disliked: new Set(),
    seen: new Set(),
    currentView: 'view-swipe',
    selectedDayIndex: 0,
    scheduleFilter: 'all', // 'all', 'after18', 'liked', 'unseen'
    movies: [],
    days: [],
    activeDeck: []
  };

  function loadStateFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        state.liked = new Set(parsed.liked || []);
        state.disliked = new Set(parsed.disliked || []);
        state.seen = new Set(parsed.seen || []);
      }
    } catch (e) {
      console.warn("Impossible de charger le LocalStorage:", e);
    }
  }

  function saveStateToStorage() {
    try {
      const dataToSave = {
        liked: Array.from(state.liked),
        disliked: Array.from(state.disliked),
        seen: Array.from(state.seen)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
      console.warn("Erreur d'écriture dans LocalStorage:", e);
    }
    updateHeaderBadges();
    renderSchedule();
    renderSelectionLists();
  }

  // ==========================================================================
  // Initialisation des données (avec cache localStorage par cinéma)
  // ==========================================================================
  function initData() {
    const cached = localStorage.getItem(CINEMA_STORAGE_PREFIX + state.selectedCinema);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        state.movies = parsed.movies || [];
        state.days = parsed.days || [];
        return;
      } catch (e) {
        console.warn("Cache corrompu:", e);
      }
    }

    if (window.CINEMA_DATA && window.CINEMA_DATA.movies && state.selectedCinema === 'pathe') {
      state.movies = window.CINEMA_DATA.movies;
      state.days = window.CINEMA_DATA.days || [];
    } else {
      state.movies = [];
      state.days = [];
    }
  }

  function saveCinemaDataToCache(cinema, data) {
    try {
      localStorage.setItem(CINEMA_STORAGE_PREFIX + cinema, JSON.stringify(data));
    } catch (e) {
      console.warn("Erreur sauvegarde cache cinéma:", e);
    }
  }

  function getMovieById(id) {
    return state.movies.find(m => m.id === id);
  }

  function getMovieStatus(movieId) {
    if (state.liked.has(movieId)) return 'liked';
    if (state.disliked.has(movieId)) return 'disliked';
    if (state.seen.has(movieId)) return 'seen';
    return 'none';
  }

  // ==========================================================================
  // Vue 1 : Swipe Tinder Deck
  // ==========================================================================
  const cardDeckEl = document.getElementById('card-deck');
  const deckEmptyEl = document.getElementById('deck-empty');

  function initDeck() {
    // Règle demandée : si un film a été swipé (like/dislike) ou marqué déjà vu,
    // il n'apparaît plus dans la pile des films à swiper !
    state.activeDeck = state.movies.filter(movie => {
      const status = getMovieStatus(movie.id);
      return status === 'none';
    });

    renderDeck();
    updateHeaderBadges();
  }

  function renderDeck() {
    cardDeckEl.innerHTML = '';

    if (state.activeDeck.length === 0) {
      cardDeckEl.classList.add('hidden');
      deckEmptyEl.classList.remove('hidden');
      return;
    }

    cardDeckEl.classList.remove('hidden');
    deckEmptyEl.classList.add('hidden');

    // On rend les cartes de la pile (les 3 premières pour la fluidité)
    const cardsToRender = state.activeDeck.slice(0, 3).reverse();

    cardsToRender.forEach((movie, index) => {
      const card = createCardElement(movie);
      cardDeckEl.appendChild(card);
      // Attacher le drag/swipe sur la carte du dessus
      if (index === cardsToRender.length - 1) {
        attachSwipeGestures(card, movie);

        // Si la carte n'a pas de note IMDb ou d'affiche, tenter un enrichissement direct en tâche de fond
        if (!movie.imdb || !movie.imdb.rating || !movie.poster_toulourama) {
          fetchOmdbDetailsClientSide(movie).then(omdb => {
            if (omdb) {
              movie.imdb = omdb;
              if (omdb.poster && (!movie.poster_toulourama || movie.poster_toulourama.includes('placeholder'))) {
                movie.poster_toulourama = omdb.poster;
                const img = card.querySelector('.card-media img');
                if (img) img.src = omdb.poster;
              }
              if (omdb.rating) {
                const badge = card.querySelector('.badge-imdb');
                if (badge) {
                  badge.className = 'badge-imdb badge-rating-trigger';
                  badge.innerHTML = `⭐ ${omdb.rating} / 10 ${omdb.votes ? `<span class="imdb-votes">(${omdb.votes})</span>` : ''}`;
                  badge.title = 'Note IMDb officielle — Cliquer pour voir les avis Google';
                }
                const btnRating = card.querySelector('.btn-card-rating');
                if (btnRating) {
                  btnRating.textContent = `⭐ ${omdb.rating}/10 (Google)`;
                }
              }
              saveCinemaDataToCache(state.selectedCinema, { movies: state.movies, days: state.days });
            }
          });
        }
      }
    });
  }

  function createCardElement(movie) {
    const card = document.createElement('div');
    card.className = 'swipe-card';
    card.dataset.id = movie.id;

    // Détermination de l'affiche
    const posterUrl = movie.poster_toulourama || (movie.imdb && movie.imdb.poster) || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&q=80';

    // Badge IMDb ou bouton direct de recherche de note
    let imdbBadgeHtml = '';
    const hasImdbRating = movie.imdb && movie.imdb.rating;
    if (hasImdbRating) {
      const votes = movie.imdb.votes ? `<span class="imdb-votes">(${movie.imdb.votes})</span>` : '';
      imdbBadgeHtml = `
        <div class="badge-imdb badge-rating-trigger" title="Note IMDb officielle — Cliquer pour voir les avis Google">
          ⭐ ${movie.imdb.rating} / 10 ${votes}
        </div>
      `;
    } else {
      imdbBadgeHtml = `
        <div class="badge-imdb badge-imdb-missing badge-rating-trigger" title="Note non dispo sur IMDb — Cliquer pour chercher la note sur Google">
          🔍 Voir la note sur internet
        </div>
      `;
    }

    // Synopsis (priorité au synopsis français de Toulourama)
    const pitch = movie.synopsis || (movie.imdb && movie.imdb.plot_en) || "Aucun synopsis disponible actuellement pour ce film.";

    card.innerHTML = `
      <!-- Tampons visuels de swipe -->
      <div class="stamp stamp-like">J'AIME</div>
      <div class="stamp stamp-dislike">PASSER</div>
      <div class="stamp stamp-seen">DÉJÀ VU</div>

      <!-- Média Affiche & Bouton Bande-Annonce -->
      <div class="card-media" title="Cliquer pour voir la bande-annonce">
        <img src="${posterUrl}" alt="${movie.title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&q=80';">
        <div class="card-media-gradient"></div>
        <button class="play-trailer-btn" type="button" title="Ouvrir la bande-annonce sur YouTube">
          <span class="play-triangle">▶</span> Bande-annonce
        </button>
        ${imdbBadgeHtml}
      </div>

      <!-- Contenu & Pitch -->
      <div class="card-body">
        <div class="card-title-row">
          <h2 class="card-title">${movie.title}</h2>
          <span class="card-duration">${movie.duration || ''}</span>
        </div>
        <div class="card-meta">
          ${movie.director ? `<span>🎬 ${movie.director}</span>` : ''}
          ${movie.genre ? `<span>🎭 ${movie.genre.split('Avec')[0]}</span>` : ''}
        </div>

        <!-- Raccourcis clés de décision rapide (Bande annonce & Note) -->
        <div class="card-quick-actions">
          <button class="btn-card-action btn-card-trailer" type="button" title="Bande-annonce sur YouTube">
            ▶ Bande-annonce
          </button>
          <button class="btn-card-action btn-card-rating" type="button" title="Chercher la note et les avis sur Google">
            ⭐ ${hasImdbRating ? `${movie.imdb.rating}/10 (Google)` : 'Voir la note (Google)'}
          </button>
        </div>

        <div class="card-pitch">
          <p>${pitch}</p>
        </div>
      </div>
    `;

    // Clic sur l'image ou sur le bouton bande-annonce
    const mediaEl = card.querySelector('.card-media');
    const trailerBtn = card.querySelector('.play-trailer-btn');
    const cardTrailerBtn = card.querySelector('.btn-card-trailer');
    const ratingBadge = card.querySelector('.badge-rating-trigger');
    const cardRatingBtn = card.querySelector('.btn-card-rating');

    if (trailerBtn) {
      trailerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTrailer(movie);
      });
    }

    if (cardTrailerBtn) {
      cardTrailerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTrailer(movie);
      });
    }

    if (ratingBadge) {
      ratingBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        openGoogleRating(movie);
      });
    }

    if (cardRatingBtn) {
      cardRatingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openGoogleRating(movie);
      });
    }

    mediaEl.addEventListener('click', (e) => {
      // Éviter de déclencher si on swipait ou cliqué sur un bouton spécifique
      if (card._isDragging || e.target.closest('.play-trailer-btn') || e.target.closest('.badge-imdb')) return;
      openTrailer(movie);
    });

    return card;
  }

  // ==========================================================================
  // Gestion du Drag & Swipe Tactile / Souris
  // ==========================================================================
  function attachSwipeGestures(card, movie) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isDragging = false;

    const stampLike = card.querySelector('.stamp-like');
    const stampDislike = card.querySelector('.stamp-dislike');
    const stampSeen = card.querySelector('.stamp-seen');

    function onStart(e) {
      if (e.target.closest('.card-pitch')) {
        // Laisser défiler le texte si on scrolle verticalement dans le pitch
      }
      isDragging = true;
      card._isDragging = false;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX;
      startY = clientY;
      card.style.transition = 'none';
    }

    function onMove(e) {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      currentX = clientX - startX;
      currentY = clientY - startY;

      if (Math.abs(currentX) > 8 || Math.abs(currentY) > 8) {
        card._isDragging = true;
      }

      // Rotation proportionnelle au déplacement horizontal
      const rotate = currentX * 0.08;
      card.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotate}deg)`;

      // Gestion de l'opacité des tampons
      if (currentX > 30) {
        stampLike.style.opacity = Math.min(currentX / 120, 1);
        stampDislike.style.opacity = 0;
        stampSeen.style.opacity = 0;
      } else if (currentX < -30) {
        stampDislike.style.opacity = Math.min(Math.abs(currentX) / 120, 1);
        stampLike.style.opacity = 0;
        stampSeen.style.opacity = 0;
      } else if (currentY < -40) {
        stampSeen.style.opacity = Math.min(Math.abs(currentY) / 100, 1);
        stampLike.style.opacity = 0;
        stampDislike.style.opacity = 0;
      } else {
        stampLike.style.opacity = 0;
        stampDislike.style.opacity = 0;
        stampSeen.style.opacity = 0;
      }
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;

      const threshold = 95;
      const verticalThreshold = -100;

      if (currentX > threshold) {
        // Swipe Droit -> Like
        triggerSwipe(card, movie, 'right');
      } else if (currentX < -threshold) {
        // Swipe Gauche -> Dislike
        triggerSwipe(card, movie, 'left');
      } else if (currentY < verticalThreshold && Math.abs(currentX) < 60) {
        // Swipe Haut -> Déjà vu
        triggerSwipe(card, movie, 'up');
      } else {
        // Rétablir la carte à sa position centrale
        card.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        card.style.transform = 'translate(0px, 0px) rotate(0deg)';
        stampLike.style.opacity = 0;
        stampDislike.style.opacity = 0;
        stampSeen.style.opacity = 0;
      }
    }

    card.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);

    card.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  }

  function triggerSwipe(card, movie, direction) {
    card.style.transition = 'transform 0.35s ease-out, opacity 0.3s ease-out';

    if (direction === 'right') {
      card.style.transform = 'translate(140vw, 30px) rotate(35deg)';
      card.style.opacity = '0';
      state.liked.add(movie.id);
      state.disliked.delete(movie.id);
      state.seen.delete(movie.id);
      showToast(`💚 "${movie.title}" ajouté à vos envies !`);
    } else if (direction === 'left') {
      card.style.transform = 'translate(-140vw, 30px) rotate(-35deg)';
      card.style.opacity = '0';
      state.disliked.add(movie.id);
      state.liked.delete(movie.id);
      state.seen.delete(movie.id);
      showToast(`❌ "${movie.title}" ignoré`);
    } else if (direction === 'up' || direction === 'seen') {
      card.style.transform = 'translate(0, -120vh) rotate(0deg)';
      card.style.opacity = '0';
      state.seen.add(movie.id);
      state.liked.delete(movie.id);
      state.disliked.delete(movie.id);
      showToast(`👁️ "${movie.title}" marqué comme déjà vu`);
    } else if (direction === 'skip') {
      // Neutre : on le place simplement à la fin de la file sans l'enregistrer comme dislike
      card.style.transform = 'translate(0, 100px) scale(0.9)';
      card.style.opacity = '0';
      state.activeDeck.push(state.activeDeck.shift());
      setTimeout(renderDeck, 200);
      showToast(`⏭️ Reporté`);
      return;
    }

    setTimeout(() => {
      // Retirer définitivement le film de la pile active
      state.activeDeck = state.activeDeck.filter(m => m.id !== movie.id);
      saveStateToStorage();
      renderDeck();
    }, 280);
  }

  // ==========================================================================
  // Écouteurs des boutons d'actions sous les cartes
  // ==========================================================================
  function setupSwipeButtons() {
    document.getElementById('btn-like').addEventListener('click', () => {
      const topMovie = state.activeDeck[0];
      const topCard = cardDeckEl.querySelector('.swipe-card:last-child');
      if (topMovie && topCard) {
        topCard.querySelector('.stamp-like').style.opacity = 1;
        triggerSwipe(topCard, topMovie, 'right');
      }
    });

    document.getElementById('btn-dislike').addEventListener('click', () => {
      const topMovie = state.activeDeck[0];
      const topCard = cardDeckEl.querySelector('.swipe-card:last-child');
      if (topMovie && topCard) {
        topCard.querySelector('.stamp-dislike').style.opacity = 1;
        triggerSwipe(topCard, topMovie, 'left');
      }
    });

    document.getElementById('btn-seen').addEventListener('click', () => {
      const topMovie = state.activeDeck[0];
      const topCard = cardDeckEl.querySelector('.swipe-card:last-child');
      if (topMovie && topCard) {
        topCard.querySelector('.stamp-seen').style.opacity = 1;
        triggerSwipe(topCard, topMovie, 'seen');
      }
    });

    document.getElementById('btn-skip').addEventListener('click', () => {
      const topMovie = state.activeDeck[0];
      const topCard = cardDeckEl.querySelector('.swipe-card:last-child');
      if (topMovie && topCard) {
        triggerSwipe(topCard, topMovie, 'skip');
      }
    });

    document.getElementById('btn-reset-deck').addEventListener('click', () => {
      resetUserPreferences();
    });

    document.getElementById('btn-goto-schedule').addEventListener('click', () => {
      switchView('view-schedule');
    });
  }

  // ==========================================================================
  // VUE 2 : Programmation Pathé (Style Toulourama)
  // ==========================================================================
  const dayTabsContainer = document.getElementById('day-tabs');
  const scheduleListContainer = document.getElementById('schedule-list');

  function initSchedule() {
    dayTabsContainer.innerHTML = '';
    state.days.forEach((day, index) => {
      const btn = document.createElement('button');
      btn.className = `day-tab ${index === state.selectedDayIndex ? 'active' : ''}`;
      btn.textContent = day.day_title;
      btn.addEventListener('click', () => {
        state.selectedDayIndex = index;
        document.querySelectorAll('.day-tab').forEach((t, i) => t.classList.toggle('active', i === index));
        renderSchedule();
      });
      dayTabsContainer.appendChild(btn);
    });

    // Filtres rapides
    const filterButtons = document.querySelectorAll('.schedule-quick-filters .filter-pill');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.scheduleFilter = btn.dataset.filter;
        renderSchedule();
      });
    });

    renderSchedule();
  }

  function renderSchedule() {
    if (!state.days.length || !state.days[state.selectedDayIndex]) {
      scheduleListContainer.innerHTML = '<p class="empty-msg">Aucune séance disponible.</p>';
      return;
    }

    const currentDay = state.days[state.selectedDayIndex];
    let seances = currentDay.seances || [];

    // Helper pour vérifier si une séance est après 18h00 (>= 18h00)
    function isAfter18h(timeStr) {
      if (!timeStr) return false;
      const match = timeStr.match(/(\d{1,2})[:hH](\d{2})/);
      if (match) {
        const hour = parseInt(match[1], 10);
        return hour >= 18;
      }
      return false;
    }

    // Application des filtres utilisateur
    if (state.scheduleFilter === 'after18') {
      seances = seances.filter(s => isAfter18h(s.time));
    } else if (state.scheduleFilter === 'liked') {
      seances = seances.filter(s => state.liked.has(s.film_id));
    } else if (state.scheduleFilter === 'unseen') {
      seances = seances.filter(s => !state.seen.has(s.film_id) && !state.disliked.has(s.film_id));
    }

    if (seances.length === 0) {
      scheduleListContainer.innerHTML = `
        <div class="empty-card" style="padding: 24px 16px; margin-top: 10px;">
          <p>Aucune séance ne correspond au filtre sélectionné pour ce jour.</p>
        </div>
      `;
      return;
    }

    scheduleListContainer.innerHTML = '';

    seances.forEach(seance => {
      const movie = getMovieById(seance.film_id);
      const status = getMovieStatus(seance.film_id);

      // Classes de statut exigées par l'utilisateur :
      // - vert pour ceux qui m'intéressent (status-liked)
      // - rouge pour ceux swipés négatifs (status-disliked)
      // - grisé/marqué pour déjà vu (status-seen)
      let statusClass = '';
      let statusBadge = '';
      if (status === 'liked') {
        statusClass = 'status-liked';
        statusBadge = '<span class="pill pill-green" style="font-size:0.65rem;padding:2px 6px;">💚 Intéressé</span>';
      } else if (status === 'disliked') {
        statusClass = 'status-disliked';
        statusBadge = '<span class="pill" style="font-size:0.65rem;padding:2px 6px;background:rgba(239,68,68,0.15);color:#ef4444;">❌ Ignoré</span>';
      } else if (status === 'seen') {
        statusClass = 'status-seen';
        statusBadge = '<span class="pill" style="font-size:0.65rem;padding:2px 6px;background:rgba(99,102,241,0.15);color:#818cf8;">👁️ Vu</span>';
      }

      const posterUrl = movie ? (movie.poster_toulourama || (movie.imdb && movie.imdb.poster)) : '';
      const imdbRating = (movie && movie.imdb && movie.imdb.rating) ? `⭐ ${movie.imdb.rating}/10` : '';

      const card = document.createElement('div');
      card.className = `seance-card ${statusClass}`;
      card.innerHTML = `
        <img class="seance-poster-thumb" src="${posterUrl}" alt="${seance.title}" loading="lazy" onerror="this.style.display='none';">
        <div class="seance-info">
          <div class="seance-title-row">
            <span class="seance-time">${seance.time}</span>
            <div style="display:flex;gap:4px;align-items:center;">
              ${statusBadge}
              <span class="seance-version">${seance.version || 'VF'}</span>
            </div>
          </div>
          
          <h3 class="seance-film-title" title="Voir les détails et le pitch">${seance.title}</h3>
          
          <div class="seance-meta">
            ${movie && movie.duration ? `<span>⏱️ ${movie.duration}</span>` : ''}
            ${imdbRating ? `<span class="seance-imdb-pill seance-rating-btn" style="cursor:pointer;" title="Voir les avis Google">${imdbRating}</span>` : `<span class="seance-rating-btn" style="color:#fde047;font-size:0.7rem;cursor:pointer;" title="Chercher la note sur Google">🔍 Note internet</span>`}
          </div>

          <div class="seance-footer-row">
            <span class="seance-cinema">${seance.cinema}</span>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-outline btn-trailer-quick" style="font-size:0.7rem;padding:4px 8px;border-color:rgba(239,68,68,0.35);color:#fca5a5;" type="button" title="Bande-annonce sur YouTube">
                ▶ BA
              </button>
              <button class="btn btn-outline btn-detail-trigger" style="font-size:0.7rem;padding:4px 8px;" type="button">
                ℹ️ Pitch
              </button>
              ${seance.booking_url ? `
                <a href="${seance.booking_url}" target="_blank" class="btn-book" rel="noopener">
                  🎟️ Réserver
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      `;

      // Clic pour ouvrir les détails complets (pitch + trailer)
      const detailBtn = card.querySelector('.btn-detail-trigger');
      const trailerQuickBtn = card.querySelector('.btn-trailer-quick');
      const ratingQuickBtn = card.querySelector('.seance-rating-btn');
      const titleEl = card.querySelector('.seance-film-title');
      const thumbEl = card.querySelector('.seance-poster-thumb');

      if (trailerQuickBtn && movie) {
        trailerQuickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openTrailer(movie);
        });
      }

      if (ratingQuickBtn && movie) {
        ratingQuickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openGoogleRating(movie);
        });
      }

      const openDetails = () => { if (movie) openDetailModal(movie); };
      if (detailBtn) detailBtn.addEventListener('click', openDetails);
      if (titleEl) titleEl.addEventListener('click', openDetails);
      if (thumbEl) thumbEl.addEventListener('click', openDetails);

      scheduleListContainer.appendChild(card);
    });
  }

  // ==========================================================================
  // VUE 3 : Mes Sélections & Statistiques
  // ==========================================================================
  function renderSelectionLists() {
    document.getElementById('stat-liked-count').textContent = state.liked.size;
    document.getElementById('stat-seen-count').textContent = state.seen.size;
    document.getElementById('stat-disliked-count').textContent = state.disliked.size;

    renderMiniList('liked-list', state.liked, 'liked');
    renderMiniList('seen-list', state.seen, 'seen');
    renderMiniList('disliked-list', state.disliked, 'disliked');
  }

  function renderMiniList(containerId, idSet, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (idSet.size === 0) {
      container.innerHTML = `<p class="empty-msg" style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.85rem;">Aucun film dans cette catégorie.</p>`;
      return;
    }

    idSet.forEach(id => {
      const movie = getMovieById(id);
      if (!movie) return;

      const poster = movie.poster_toulourama || (movie.imdb && movie.imdb.poster) || '';
      const card = document.createElement('div');
      card.className = 'mini-movie-card';
      card.innerHTML = `
        <img class="mini-poster" src="${poster}" alt="${movie.title}" onerror="this.src='https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=100';">
        <div class="mini-info">
          <h4 class="mini-title">${movie.title}</h4>
          <p class="mini-meta">
            ${movie.duration ? `⏱️ ${movie.duration}` : ''}
            ${movie.imdb && movie.imdb.rating ? ` • ⭐ ${movie.imdb.rating}/10` : ''}
          </p>
        </div>
        <button class="btn-remove-status" title="Retirer et remettre dans le swipe deck" data-id="${movie.id}">
          ✕
        </button>
      `;

      card.querySelector('.btn-remove-status').addEventListener('click', (e) => {
        e.stopPropagation();
        idSet.delete(movie.id);
        saveStateToStorage();
        initDeck();
        showToast(`"${movie.title}" remis dans la pile à swiper.`);
      });

      card.addEventListener('click', () => openDetailModal(movie));
      container.appendChild(card);
    });
  }

  function setupSelectionTabs() {
    const tabs = document.querySelectorAll('.sel-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.movie-mini-list').forEach(l => l.classList.remove('active'));
        const target = document.getElementById(tab.dataset.target);
        if (target) target.classList.add('active');
      });
    });

    document.getElementById('btn-clear-all').addEventListener('click', () => {
      if (confirm("Voulez-vous vraiment réinitialiser tous vos choix et recommencer le tri ?")) {
        resetUserPreferences();
      }
    });
  }

  function resetUserPreferences() {
    state.liked.clear();
    state.disliked.clear();
    state.seen.clear();
    localStorage.removeItem(STORAGE_KEY);
    initDeck();
    saveStateToStorage();
    showToast("🔄 Vos préférences ont été réinitialisées !");
  }

  // ==========================================================================
  // Modals : Trailer (Rickroll) & Détails
  // ==========================================================================
  const trailerModal = document.getElementById('trailer-modal');
  const trailerIframe = document.getElementById('trailer-iframe');
  const trailerTitle = document.getElementById('trailer-title');
  const btnCloseTrailer = document.getElementById('btn-close-trailer');

  function openTrailerModal(movie) {
    openTrailer(movie);
  }

  // Modal Détail
  const detailModal = document.getElementById('detail-modal');
  const detailBody = document.getElementById('detail-body');
  const btnCloseDetail = document.getElementById('btn-close-detail');

  function openDetailModal(movie) {
    const poster = movie.poster_toulourama || (movie.imdb && movie.imdb.poster) || '';
    const pitch = movie.synopsis || (movie.imdb && movie.imdb.plot_en) || "Aucun synopsis disponible.";
    const status = getMovieStatus(movie.id);

    let statusPill = '';
    if (status === 'liked') statusPill = '<span class="pill pill-green">💚 Dans vos favoris</span>';
    else if (status === 'disliked') statusPill = '<span class="pill pill-dislike" style="background:rgba(239,68,68,0.2);color:#ef4444;">❌ Rejeté</span>';
    else if (status === 'seen') statusPill = '<span class="pill" style="background:rgba(99,102,241,0.2);color:#818cf8;">👁️ Déjà vu</span>';

    detailBody.innerHTML = `
      <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px;">
        <img src="${poster}" alt="${movie.title}" style="width:85px;border-radius:10px;object-fit:cover;flex-shrink:0;">
        <div>
          <h2 style="font-size:1.2rem;font-weight:800;color:#fff;">${movie.title}</h2>
          <div style="margin:4px 0;">${statusPill}</div>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            ${movie.duration ? `⏱️ ${movie.duration}` : ''}
            ${movie.director ? ` • 🎬 ${movie.director}` : ''}
          </p>
          ${movie.imdb && movie.imdb.rating ? `
            <div style="margin-top:6px;font-size:0.8rem;font-weight:700;color:#f5c518;">
              ⭐ Note IMDb: ${movie.imdb.rating}/10 (${movie.imdb.votes || 'N/A'} votes)
            </div>
          ` : ''}
        </div>
      </div>

      <div class="modal-action-buttons">
        <button id="modal-launch-trailer" class="btn btn-primary" type="button" title="Ouvrir la bande-annonce sur YouTube">
          ▶ Bande-annonce (YouTube)
        </button>
        <button id="modal-search-rating" class="btn btn-outline" style="border-color:#f5c518;color:#fde047;" type="button" title="Chercher la note et les avis sur Google">
          🔍 Voir la note sur internet
        </button>
      </div>

      <h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Pitch / Synopsis :</h4>
      <p style="font-size:0.85rem;line-height:1.5;color:#d1d5db;margin-bottom:16px;">
        ${pitch}
      </p>

      <div style="display:flex;gap:8px;margin-top:10px;">
        <button id="btn-modal-like" class="btn btn-outline" style="flex:1;color:var(--color-like);border-color:rgba(16,185,129,0.4);">
          💚 J'aime
        </button>
        <button id="btn-modal-dislike" class="btn btn-outline" style="flex:1;color:var(--color-dislike);border-color:rgba(239,68,68,0.4);">
          ❌ Ignorer
        </button>
        <button id="btn-modal-seen" class="btn btn-outline" style="flex:1;color:var(--color-seen);border-color:rgba(99,102,241,0.4);">
          👁️ Vu
        </button>
      </div>
    `;

    document.getElementById('modal-launch-trailer').addEventListener('click', () => {
      openTrailer(movie);
    });

    document.getElementById('modal-search-rating').addEventListener('click', () => {
      openGoogleRating(movie);
    });

    document.getElementById('btn-modal-like').addEventListener('click', () => {
      state.liked.add(movie.id);
      state.disliked.delete(movie.id);
      state.seen.delete(movie.id);
      saveStateToStorage();
      initDeck();
      closeDetailModal();
      showToast(`💚 "${movie.title}" ajouté à vos choix !`);
    });

    document.getElementById('btn-modal-dislike').addEventListener('click', () => {
      state.disliked.add(movie.id);
      state.liked.delete(movie.id);
      state.seen.delete(movie.id);
      saveStateToStorage();
      initDeck();
      closeDetailModal();
      showToast(`❌ "${movie.title}" ignoré.`);
    });

    document.getElementById('btn-modal-seen').addEventListener('click', () => {
      state.seen.add(movie.id);
      state.liked.delete(movie.id);
      state.disliked.delete(movie.id);
      saveStateToStorage();
      initDeck();
      closeDetailModal();
      showToast(`👁️ "${movie.title}" marqué comme déjà vu.`);
    });

    detailModal.classList.remove('hidden');
  }

  function closeDetailModal() {
    detailModal.classList.add('hidden');
  }

  btnCloseDetail.addEventListener('click', closeDetailModal);
  detailModal.querySelector('.modal-backdrop').addEventListener('click', closeDetailModal);

  // ==========================================================================
  // Navigation entre les Vues
  // ==========================================================================
  function setupNavigation() {
    const navItems = document.querySelectorAll('.bottom-nav .nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const targetView = item.dataset.view;
        switchView(targetView);
      });
    });
  }

  function switchView(viewId) {
    state.currentView = viewId;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    const targetEl = document.getElementById(viewId);
    if (targetEl) targetEl.classList.add('active');

    if (viewId === 'view-schedule') {
      renderSchedule();
    } else if (viewId === 'view-selection') {
      renderSelectionLists();
    }
  }

  function updateHeaderBadges() {
    document.getElementById('count-likes').textContent = state.liked.size;
    document.getElementById('count-remaining').textContent = state.activeDeck.length;
  }

  // Toast Helper
  let toastTimeout = null;
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2400);
  }

  // ==========================================================================
  // Actualisation en Direct via Google Apps Script & Auto-Enrichissement OMDb
  // ==========================================================================
  async function refreshCinemaData(forceCinema = null) {
    const cinema = forceCinema || state.selectedCinema || 'pathe';
    const refreshBtn = document.getElementById('btn-refresh-cinema');
    if (refreshBtn) refreshBtn.classList.add('spinning');
    
    showToast(`🔄 Récupération de la programmation ${cinema.toUpperCase()}...`);

    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?cinema=${cinema}`);
      const data = await response.json();

      if (data && data.status === 'success' && data.movies && data.movies.length > 0) {
        state.movies = data.movies;
        state.days = data.days || [];
        state.selectedDayIndex = 0;

        showToast(`✨ ${state.movies.length} films récupérés ! Auto-complétion IMDb...`);

        // Enregistrer d'abord les données brutes dans le cache
        saveCinemaDataToCache(cinema, { movies: state.movies, days: state.days });
        initDeck();
        initSchedule();

        // Auto-enrichissement IMDb/OMDb en tâche de fond dans le navigateur
        enrichMoviesWithoutPosterOrRating(state.movies, cinema);
      } else {
        showToast(`⚠️ Aucune séance trouvée pour ${cinema.toUpperCase()}.`);
      }
    } catch (err) {
      console.error("Erreur actualisation Apps Script:", err);
      showToast(`❌ Erreur de connexion au proxy Toulourama.`);
    } finally {
      if (refreshBtn) refreshBtn.classList.remove('spinning');
    }
  }

  // Auto-enrichissement asynchrone côté client pour les films sans note ou sans affiche
  async function enrichMoviesWithoutPosterOrRating(movies, cinema) {
    let updatedCount = 0;
    for (const movie of movies) {
      const missingPoster = !movie.poster_toulourama || movie.poster_toulourama.includes('placeholder');
      const missingRating = !movie.imdb || !movie.imdb.rating;

      if (missingPoster || missingRating) {
        const omdb = await fetchOmdbDetailsClientSide(movie);
        if (omdb) {
          movie.imdb = omdb;
          if (missingPoster && omdb.poster) {
            movie.poster_toulourama = omdb.poster;
          }
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      saveCinemaDataToCache(cinema, { movies: state.movies, days: state.days });
      renderDeck();
      renderSchedule();
      showToast(`⭐ ${updatedCount} film(s) enrichi(s) avec IMDb !`);
    }
  }

  function setupCinemaControls() {
    const selectEl = document.getElementById('select-cinema');
    const refreshBtn = document.getElementById('btn-refresh-cinema');

    if (selectEl) {
      selectEl.value = state.selectedCinema;
      selectEl.addEventListener('change', () => {
        const newCinema = selectEl.value;
        state.selectedCinema = newCinema;
        localStorage.setItem('cinematch_current_cinema', newCinema);
        
        // Charger les données de ce cinéma
        initData();
        if (state.movies.length === 0) {
          // Si pas de données en cache, actualiser automatiquement
          refreshCinemaData(newCinema);
        } else {
          initDeck();
          initSchedule();
          showToast(`📍 Passage à ${newCinema === 'utopia' ? 'Utopia' : 'Pathé'}`);
        }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshCinemaData();
      });
    }
  }

  // ==========================================================================
  // Démarrage de l'Application
  // ==========================================================================
  function init() {
    loadStateFromStorage();
    initData();
    initDeck();
    setupSwipeButtons();
    initSchedule();
    setupSelectionTabs();
    setupNavigation();
    setupCinemaControls();
    renderSelectionLists();

    // Si on a sélectionné un cinéma sans données chargées, on lance le refresh
    if (state.movies.length === 0) {
      refreshCinemaData(state.selectedCinema);
    }
  }

  // Attendre le chargement complet du DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
