/**
 * CinéMatch — Application Cinéma Mobile-First (PWA)
 * Données temps réel Toulourama (Pathé / Utopia) & IMDb (OMDb API)
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'cinematch_preferences_v1';
  const CINEMA_STORAGE_PREFIX = 'cinematch_db_';
  const LAST_REFRESH_PREFIX = 'cinematch_last_refresh_';
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4PUen42hiYlpHtgSKwAzJYEtHj-LHoCFbC8un1R_NfAFb7wA3CwmQzqtgd9l2ou7Z/exec';
  const OMDB_API_KEY = 'cd47ed88';

  function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getTodayCompactId() {
    return getTodayKey().replace(/-/g, '');
  }

  function cleanGenreText(rawGenre) {
    if (!rawGenre) return '';
    let g = rawGenre.split('Avec')[0];
    g = g.replace(/^[A-Za-zÀ-ÿ\-\s]+\d{4}/, '').replace(/^(France|États-Unis|Etats-Unis|Belgique|Royaume-Uni|Japon|Italie|Espagne|Allemagne|Canada|Corée du Sud)/i, '');
    return g.trim();
  }

  function formatDayTabLabel(day) {
    const todayId = getTodayCompactId();
    const parts = (day.day_title || '').trim().split(/\s+/);
    // Exemple: ["Mardi", "13", "octobre"]
    const weekday = parts[0] ? parts[0].slice(0, 3).toUpperCase() : '';
    const num = parts[1] || '';
    const month = parts[2] ? parts[2].slice(0, 3).toLowerCase() : '';
    const isToday = day.day_id === todayId;

    return {
      top: isToday ? 'AUJ.' : `${weekday}.`,
      bottom: `${num} ${month}`.trim()
    };
  }

  function getYouTubeTrailerSearchUrl(movie) {
    const currentYear = new Date().getFullYear();
    const queryParts = [movie.title];
    if (movie.director && movie.director.trim()) {
      queryParts.push(movie.director.trim());
    }
    queryParts.push('Bande annonce', currentYear);
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(queryParts.join(' '))}`;
  }

  function openTrailer(movie) {
    window.open(getYouTubeTrailerSearchUrl(movie), '_blank', 'noopener,noreferrer');
  }

  function getGoogleRatingSearchUrl(movie) {
    const queryParts = [movie.title];
    if (movie.director && movie.director.trim()) {
      queryParts.push(movie.director.trim());
    }
    queryParts.push('note avis');
    return `https://www.google.com/search?q=${encodeURIComponent(queryParts.join(' '))}`;
  }

  function openGoogleRating(movie) {
    window.open(getGoogleRatingSearchUrl(movie), '_blank', 'noopener,noreferrer');
  }

  // ==========================================================================
  // Enrichissement OMDb côté client
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
      console.warn('Erreur OMDb client-side:', e);
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
    currentView: 'view-schedule',
    selectedDayIndex: 0,
    scheduleFilter: 'all',
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
      console.warn('Impossible de charger le LocalStorage:', e);
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
  // Initialisation des données & Cache par cinéma
  // ==========================================================================
  function initData() {
    const cached = localStorage.getItem(CINEMA_STORAGE_PREFIX + state.selectedCinema);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        state.movies = parsed.movies || [];
        state.days = parsed.days || [];
        selectDefaultDayIndex();
        return;
      } catch (e) {
        console.warn('Cache corrompu:', e);
      }
    }

    if (window.CINEMA_DATA && window.CINEMA_DATA.movies && state.selectedCinema === 'pathe') {
      state.movies = window.CINEMA_DATA.movies;
      state.days = window.CINEMA_DATA.days || [];
    } else {
      state.movies = [];
      state.days = [];
    }
    selectDefaultDayIndex();
  }

  function selectDefaultDayIndex() {
    const todayId = getTodayCompactId();
    const idx = state.days.findIndex(d => d.day_id === todayId);
    state.selectedDayIndex = idx >= 0 ? idx : 0;
  }

  function saveCinemaDataToCache(cinema, data) {
    try {
      localStorage.setItem(CINEMA_STORAGE_PREFIX + cinema, JSON.stringify({
        ...data,
        lastRefreshDate: getTodayKey()
      }));
    } catch (e) {
      console.warn('Erreur sauvegarde cache cinéma:', e);
    }
  }

  function needsDailyRefresh(cinema) {
    const today = getTodayKey();
    const lastRefresh = localStorage.getItem(LAST_REFRESH_PREFIX + cinema);
    return lastRefresh !== today;
  }

  function markRefreshedToday(cinema) {
    try {
      localStorage.setItem(LAST_REFRESH_PREFIX + cinema, getTodayKey());
    } catch (e) {
      console.warn('Erreur sauvegarde date refresh:', e);
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
  // VUE 2 : Découvrir (Swipe Deck)
  // ==========================================================================
  const cardDeckEl = document.getElementById('card-deck');
  const deckEmptyEl = document.getElementById('deck-empty');

  function initDeck() {
    state.activeDeck = state.movies.filter(movie => getMovieStatus(movie.id) === 'none');
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

    const cardsToRender = state.activeDeck.slice(0, 3).reverse();

    cardsToRender.forEach((movie, index) => {
      const card = createCardElement(movie);
      cardDeckEl.appendChild(card);

      if (index === cardsToRender.length - 1) {
        attachSwipeGestures(card, movie);

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
                  badge.innerHTML = `★ ${omdb.rating}`;
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

    const posterUrl = movie.poster_toulourama || (movie.imdb && movie.imdb.poster) || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&q=80';
    const hasImdbRating = movie.imdb && movie.imdb.rating;

    const imdbBadgeHtml = hasImdbRating
      ? `<div class="badge-imdb badge-rating-trigger" title="Voir les avis sur Google">★ ${movie.imdb.rating}</div>`
      : `<div class="badge-imdb badge-imdb-missing badge-rating-trigger" title="Chercher les avis sur Google">★ Avis web</div>`;

    const pitch = movie.synopsis || (movie.imdb && movie.imdb.plot_en) || 'Synopsis non communiqué.';
    const genreClean = cleanGenreText(movie.genre);
    const metaParts = [movie.director, genreClean].filter(Boolean);

    card.innerHTML = `
      <div class="stamp stamp-like">ENVIE</div>
      <div class="stamp stamp-dislike">PASSER</div>
      <div class="stamp stamp-seen">VU</div>

      <div class="card-media">
        <img src="${posterUrl}" alt="${movie.title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&q=80';">
        <div class="card-media-gradient"></div>
        ${imdbBadgeHtml}
        <button class="play-trailer-btn" type="button" title="Bande-annonce YouTube">
          <span>▶</span> Bande-annonce
        </button>
      </div>

      <div class="card-body">
        <div class="card-title-row">
          <h2 class="card-title">${movie.title}</h2>
          <span class="card-duration">${movie.duration || ''}</span>
        </div>
        ${metaParts.length ? `<div class="card-meta">${metaParts.join(' • ')}</div>` : ''}
        <div class="card-pitch">
          <p>${pitch}</p>
        </div>
      </div>
    `;

    const trailerBtn = card.querySelector('.play-trailer-btn');
    const ratingBadge = card.querySelector('.badge-rating-trigger');
    const mediaEl = card.querySelector('.card-media');

    if (trailerBtn) {
      trailerBtn.addEventListener('click', (e) => {
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

    mediaEl.addEventListener('click', (e) => {
      if (card._isDragging || e.target.closest('.play-trailer-btn') || e.target.closest('.badge-imdb')) return;
      openDetailModal(movie);
    });

    return card;
  }

  // ==========================================================================
  // Gestes Tactiles / Souris (Swipe)
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
      isDragging = true;
      card._isDragging = false;
      currentX = 0;
      currentY = 0;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
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

      const rotate = currentX * 0.07;
      card.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotate}deg)`;

      if (currentX > 30) {
        stampLike.style.opacity = Math.min(currentX / 110, 1);
        stampDislike.style.opacity = 0;
        stampSeen.style.opacity = 0;
      } else if (currentX < -30) {
        stampDislike.style.opacity = Math.min(Math.abs(currentX) / 110, 1);
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

      if (currentX > 95) {
        triggerSwipe(card, movie, 'right');
      } else if (currentX < -95) {
        triggerSwipe(card, movie, 'left');
      } else if (currentY < -100 && Math.abs(currentX) < 60) {
        triggerSwipe(card, movie, 'up');
      } else {
        card.style.transition = 'transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
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
    card.style.transition = 'transform 0.32s ease-out, opacity 0.26s ease-out';

    if (direction === 'right') {
      card.style.transform = 'translate(135vw, 24px) rotate(28deg)';
      card.style.opacity = '0';
      state.liked.add(movie.id);
      state.disliked.delete(movie.id);
      state.seen.delete(movie.id);
      showToast(`Ajouté aux envies`);
    } else if (direction === 'left') {
      card.style.transform = 'translate(-135vw, 24px) rotate(-28deg)';
      card.style.opacity = '0';
      state.disliked.add(movie.id);
      state.liked.delete(movie.id);
      state.seen.delete(movie.id);
    } else if (direction === 'up' || direction === 'seen') {
      card.style.transform = 'translate(0, -110vh)';
      card.style.opacity = '0';
      state.seen.add(movie.id);
      state.liked.delete(movie.id);
      state.disliked.delete(movie.id);
      showToast(`Marqué comme vu`);
    } else if (direction === 'skip') {
      card.style.transform = 'translate(0, 80px) scale(0.92)';
      card.style.opacity = '0';
      state.activeDeck.push(state.activeDeck.shift());
      setTimeout(renderDeck, 180);
      return;
    }

    setTimeout(() => {
      state.activeDeck = state.activeDeck.filter(m => m.id !== movie.id);
      saveStateToStorage();
      renderDeck();
    }, 250);
  }

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

    document.getElementById('btn-reset-deck').addEventListener('click', resetUserPreferences);
    document.getElementById('btn-goto-schedule').addEventListener('click', () => switchView('view-schedule'));
  }

  // ==========================================================================
  // VUE 1 (DÉFAUT) : Séances Pathé / Utopia
  // ==========================================================================
  const dayTabsContainer = document.getElementById('day-tabs');
  const scheduleListContainer = document.getElementById('schedule-list');

  function initSchedule() {
    dayTabsContainer.innerHTML = '';
    state.days.forEach((day, index) => {
      const btn = document.createElement('button');
      btn.className = `day-tab ${index === state.selectedDayIndex ? 'active' : ''}`;
      const label = formatDayTabLabel(day);
      btn.innerHTML = `
        <span class="day-name">${label.top}</span>
        <span class="day-num">${label.bottom}</span>
      `;
      btn.addEventListener('click', () => {
        state.selectedDayIndex = index;
        document.querySelectorAll('.day-tab').forEach((t, i) => t.classList.toggle('active', i === index));
        renderSchedule();
      });
      dayTabsContainer.appendChild(btn);
    });

    const filterButtons = document.querySelectorAll('.schedule-quick-filters .filter-pill');
    filterButtons.forEach(btn => {
      btn.onclick = () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.scheduleFilter = btn.dataset.filter;
        renderSchedule();
      };
    });

    renderSchedule();
  }

  function renderSchedule() {
    if (!state.days.length || !state.days[state.selectedDayIndex]) {
      scheduleListContainer.innerHTML = `
        <div class="empty-card" style="padding: 28px 16px; margin-top: 8px;">
          <p>Chargement des séances…</p>
        </div>
      `;
      return;
    }

    const currentDay = state.days[state.selectedDayIndex];
    let seances = currentDay.seances || [];

    function isAfter18h(timeStr) {
      if (!timeStr) return false;
      const match = timeStr.match(/(\d{1,2})[:hH](\d{2})/);
      return match ? parseInt(match[1], 10) >= 18 : false;
    }

    if (state.scheduleFilter === 'after18') {
      seances = seances.filter(s => isAfter18h(s.time));
    } else if (state.scheduleFilter === 'liked') {
      seances = seances.filter(s => state.liked.has(s.film_id));
    } else if (state.scheduleFilter === 'unseen') {
      seances = seances.filter(s => !state.seen.has(s.film_id) && !state.disliked.has(s.film_id));
    }

    if (seances.length === 0) {
      scheduleListContainer.innerHTML = `
        <div class="empty-card" style="padding: 24px 16px; margin-top: 8px;">
          <p>Aucune séance pour ce filtre.</p>
        </div>
      `;
      return;
    }

    scheduleListContainer.innerHTML = '';

    seances.forEach(seance => {
      const movie = getMovieById(seance.film_id);
      const status = getMovieStatus(seance.film_id);

      let statusClass = '';
      let statusDot = '';
      if (status === 'liked') {
        statusClass = 'status-liked';
        statusDot = '<span class="status-dot liked" title="Dans vos envies"></span>';
      } else if (status === 'disliked') {
        statusClass = 'status-disliked';
        statusDot = '<span class="status-dot disliked" title="Ignoré"></span>';
      } else if (status === 'seen') {
        statusClass = 'status-seen';
        statusDot = '<span class="status-dot seen" title="Déjà vu"></span>';
      }

      const posterUrl = movie ? (movie.poster_toulourama || (movie.imdb && movie.imdb.poster)) : '';
      const rating = (movie && movie.imdb && movie.imdb.rating) ? movie.imdb.rating : null;
      const version = (seance.version || 'VF').toUpperCase();
      const isVost = version.includes('VO');

      const metaItems = [];
      if (movie && movie.duration) metaItems.push(movie.duration);
      if (movie && movie.director) metaItems.push(movie.director.trim());

      const card = document.createElement('div');
      card.className = `seance-card ${statusClass}`;
      card.innerHTML = `
        <img class="seance-poster-thumb" src="${posterUrl}" alt="${seance.title}" loading="lazy" onerror="this.style.opacity='0.2';">
        <div class="seance-info">
          <div class="seance-top-line">
            <span class="seance-time">${seance.time}</span>
            <span class="seance-version ${isVost ? 'is-vost' : ''}">${version}</span>
            ${statusDot}
          </div>
          <h3 class="seance-film-title">${seance.title}</h3>
          <div class="seance-meta">
            <span>${metaItems.join(' • ')}</span>
            ${metaItems.length ? '<span>•</span>' : ''}
            <span class="seance-rating-chip" title="Voir les avis sur Google">
              ${rating ? `★ ${rating}` : '★ Avis'}
            </span>
          </div>
        </div>
        <div class="seance-actions">
          <button class="btn-icon-circle btn-trailer-quick" type="button" title="Bande-annonce">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          ${seance.booking_url ? `
            <a href="${seance.booking_url}" target="_blank" class="btn-book" rel="noopener" title="Réserver">
              Billet
            </a>
          ` : ''}
        </div>
      `;

      const trailerQuickBtn = card.querySelector('.btn-trailer-quick');
      const ratingQuickBtn = card.querySelector('.seance-rating-chip');
      const bookBtn = card.querySelector('.btn-book');

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

      if (bookBtn) {
        bookBtn.addEventListener('click', (e) => e.stopPropagation());
      }

      card.addEventListener('click', () => {
        if (movie) openDetailModal(movie);
      });

      scheduleListContainer.appendChild(card);
    });
  }

  // ==========================================================================
  // VUE 3 : Mes Films
  // ==========================================================================
  function renderSelectionLists() {
    document.getElementById('stat-liked-count').textContent = state.liked.size;
    document.getElementById('stat-seen-count').textContent = state.seen.size;
    document.getElementById('stat-disliked-count').textContent = state.disliked.size;

    renderMiniList('liked-list', state.liked);
    renderMiniList('seen-list', state.seen);
    renderMiniList('disliked-list', state.disliked);
  }

  function renderMiniList(containerId, idSet) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (idSet.size === 0) {
      container.innerHTML = `<p style="padding:28px 16px;text-align:center;color:var(--text-subtle);font-size:0.8rem;">Aucun film dans cette liste.</p>`;
      return;
    }

    idSet.forEach(id => {
      const movie = getMovieById(id);
      if (!movie) return;

      const poster = movie.poster_toulourama || (movie.imdb && movie.imdb.poster) || '';
      const meta = [movie.duration, movie.imdb && movie.imdb.rating ? `★ ${movie.imdb.rating}` : null].filter(Boolean).join(' • ');

      const card = document.createElement('div');
      card.className = 'mini-movie-card';
      card.innerHTML = `
        <img class="mini-poster" src="${poster}" alt="${movie.title}" onerror="this.style.opacity='0.2';">
        <div class="mini-info">
          <h4 class="mini-title">${movie.title}</h4>
          <p class="mini-meta">${meta}</p>
        </div>
        <button class="btn-remove-status" title="Retirer" data-id="${movie.id}">✕</button>
      `;

      card.querySelector('.btn-remove-status').addEventListener('click', (e) => {
        e.stopPropagation();
        idSet.delete(movie.id);
        saveStateToStorage();
        initDeck();
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
      if (confirm('Réinitialiser toutes vos sélections ?')) {
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
    showToast('Sélections réinitialisées');
  }

  // ==========================================================================
  // Modal Fiche Film (Bottom Sheet)
  // ==========================================================================
  const detailModal = document.getElementById('detail-modal');
  const detailBody = document.getElementById('detail-body');
  const btnCloseDetail = document.getElementById('btn-close-detail');

  function openDetailModal(movie) {
    const poster = movie.poster_toulourama || (movie.imdb && movie.imdb.poster) || '';
    const pitch = movie.synopsis || (movie.imdb && movie.imdb.plot_en) || 'Synopsis non disponible.';
    const status = getMovieStatus(movie.id);
    const genreClean = cleanGenreText(movie.genre);
    const metaLine = [movie.duration, movie.director, genreClean].filter(Boolean).join(' • ');

    detailBody.innerHTML = `
      <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px;padding-right:28px;">
        <img src="${poster}" alt="${movie.title}" style="width:74px;height:104px;border-radius:10px;object-fit:cover;flex-shrink:0;background:#050609;">
        <div style="min-width:0;">
          <h2 style="font-size:1.12rem;font-weight:800;color:#fff;line-height:1.25;">${movie.title}</h2>
          <p style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;">${metaLine}</p>
          ${movie.imdb && movie.imdb.rating ? `
            <div style="margin-top:6px;font-size:0.78rem;font-weight:700;color:#fde047;">
              ★ ${movie.imdb.rating}/10 ${movie.imdb.votes ? `<span style="color:var(--text-subtle);font-weight:500;">(${movie.imdb.votes})</span>` : ''}
            </div>
          ` : ''}
        </div>
      </div>

      <div class="modal-action-buttons">
        <button id="modal-launch-trailer" class="btn btn-primary" type="button">
          ▶ Bande-annonce
        </button>
        <button id="modal-search-rating" class="btn btn-outline" type="button">
          ★ Avis Google
        </button>
      </div>

      <p style="font-size:0.82rem;line-height:1.52;color:#cbd5e1;margin:10px 0;">
        ${pitch}
      </p>

      <div class="modal-status-bar">
        <button id="btn-modal-like" class="btn-status-choice ${status === 'liked' ? 'active-like' : ''}">
          ♥ Envie
        </button>
        <button id="btn-modal-seen" class="btn-status-choice ${status === 'seen' ? 'active-seen' : ''}">
          ✓ Déjà vu
        </button>
        <button id="btn-modal-dislike" class="btn-status-choice ${status === 'disliked' ? 'active-dislike' : ''}">
          ✕ Passer
        </button>
      </div>
    `;

    document.getElementById('modal-launch-trailer').addEventListener('click', () => openTrailer(movie));
    document.getElementById('modal-search-rating').addEventListener('click', () => openGoogleRating(movie));

    document.getElementById('btn-modal-like').addEventListener('click', () => {
      if (state.liked.has(movie.id)) {
        state.liked.delete(movie.id);
      } else {
        state.liked.add(movie.id);
        state.disliked.delete(movie.id);
        state.seen.delete(movie.id);
      }
      saveStateToStorage();
      initDeck();
      closeDetailModal();
    });

    document.getElementById('btn-modal-seen').addEventListener('click', () => {
      if (state.seen.has(movie.id)) {
        state.seen.delete(movie.id);
      } else {
        state.seen.add(movie.id);
        state.liked.delete(movie.id);
        state.disliked.delete(movie.id);
      }
      saveStateToStorage();
      initDeck();
      closeDetailModal();
    });

    document.getElementById('btn-modal-dislike').addEventListener('click', () => {
      if (state.disliked.has(movie.id)) {
        state.disliked.delete(movie.id);
      } else {
        state.disliked.add(movie.id);
        state.liked.delete(movie.id);
        state.seen.delete(movie.id);
      }
      saveStateToStorage();
      initDeck();
      closeDetailModal();
    });

    detailModal.classList.remove('hidden');
  }

  function closeDetailModal() {
    detailModal.classList.add('hidden');
  }

  btnCloseDetail.addEventListener('click', closeDetailModal);
  detailModal.querySelector('.modal-backdrop').addEventListener('click', closeDetailModal);

  // ==========================================================================
  // Navigation & Badges
  // ==========================================================================
  function setupNavigation() {
    const navItems = document.querySelectorAll('.bottom-nav .nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => switchView(item.dataset.view));
    });

    const badgeLikes = document.getElementById('badge-likes');
    if (badgeLikes) {
      badgeLikes.style.cursor = 'pointer';
      badgeLikes.addEventListener('click', () => switchView('view-selection'));
    }
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

  function updateNavScheduleLabel() {
    const labelEl = document.getElementById('nav-schedule-label');
    if (labelEl) {
      labelEl.textContent = state.selectedCinema === 'utopia' ? 'Séances Utopia' : 'Séances Pathé';
    }
  }

  let toastTimeout = null;
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2200);
  }

  // ==========================================================================
  // Refresh Automatique Quotidien (si date != today)
  // ==========================================================================
  async function refreshCinemaData(forceCinema = null) {
    const cinema = forceCinema || state.selectedCinema || 'pathe';
    const syncInd = document.getElementById('sync-indicator');
    if (syncInd) syncInd.classList.remove('hidden');

    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?cinema=${cinema}`);
      const data = await response.json();

      if (data && data.status === 'success' && data.movies && data.movies.length > 0) {
        state.movies = data.movies;
        state.days = data.days || [];
        selectDefaultDayIndex();

        markRefreshedToday(cinema);
        saveCinemaDataToCache(cinema, { movies: state.movies, days: state.days });

        initDeck();
        initSchedule();

        enrichMoviesWithoutPosterOrRating(state.movies, cinema);
      }
    } catch (err) {
      console.warn('Actualisation automatique en arrière-plan indisponible:', err);
    } finally {
      if (syncInd) syncInd.classList.add('hidden');
    }
  }

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
    }
  }

  function setupCinemaControls() {
    const selectEl = document.getElementById('select-cinema');
    if (selectEl) {
      selectEl.value = state.selectedCinema;
      updateNavScheduleLabel();

      selectEl.addEventListener('change', () => {
        const newCinema = selectEl.value;
        state.selectedCinema = newCinema;
        localStorage.setItem('cinematch_current_cinema', newCinema);
        updateNavScheduleLabel();

        initData();
        initDeck();
        initSchedule();

        if (state.movies.length === 0 || needsDailyRefresh(newCinema)) {
          refreshCinemaData(newCinema);
        }
      });
    }
  }

  // ==========================================================================
  // Installation PWA & Service Worker
  // ==========================================================================
  function setupPwa() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
          console.warn('Service Worker non enregistré:', err);
        });
      });
    }

    let deferredPrompt = null;
    const installBtn = document.getElementById('btn-install-pwa');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) installBtn.classList.remove('hidden');
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.classList.add('hidden');
      });
    }

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      if (installBtn) installBtn.classList.add('hidden');
      showToast('Application installée');
    });
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
    setupPwa();

    // Vue initiale : Séances Pathé
    switchView('view-schedule');

    // Refresh automatique si la date du dernier refresh != aujourd'hui (ou cache vide)
    if (state.movies.length === 0 || needsDailyRefresh(state.selectedCinema)) {
      refreshCinemaData(state.selectedCinema);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
