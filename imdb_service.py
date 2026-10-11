"""
Module de récupération des données IMDb via l'API OMDb.
Permet d'extraire :
- Note IMDb (imdbRating)
- Nombre de votes (imdbVotes)
- Pitch / Synopsis (Plot - court ou détaillé)
- Métadonnées complètes (Casting, Réalisateur, Année, Affiche, Box-Office...)
- Recherche de films par mot-clé
"""

import os
import sys
import json
from typing import Optional, Dict, Any, List
import requests
from dotenv import load_dotenv

# Charge les variables d'environnement depuis un fichier .env si présent
load_dotenv()

# Force l'encodage UTF-8 pour la sortie console sous Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Clé par défaut (clé de démonstration/test ; remplacez par votre clé personnelle)
API_KEY = os.getenv("OMDB_API_KEY", "trilogy")
BASE_URL = "https://www.omdbapi.com/"


def get_movie_by_title(
    title: str, 
    year: Optional[int] = None, 
    full_plot: bool = True,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Recherche les détails d'un film par son titre exact.
    :param title: Titre du film (ex: 'Inception', 'Interstellar')
    :param year: Année optionnelle pour filtrer
    :param full_plot: True pour le pitch complet, False pour un résumé court
    :param api_key: Clé API OMDb
    """
    params = {
        "apikey": api_key or API_KEY,
        "t": title,
        "plot": "full" if full_plot else "short",
        "r": "json"
    }
    if year:
        params["y"] = str(year)

    response = requests.get(BASE_URL, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()

    if data.get("Response") == "False":
        raise ValueError(f"Erreur API OMDb : {data.get('Error', 'Film introuvable')}")

    return data


def get_movie_by_imdb_id(
    imdb_id: str, 
    full_plot: bool = True,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Récupère un film par son identifiant unique IMDb (ex: 'tt1375666').
    """
    params = {
        "apikey": api_key or API_KEY,
        "i": imdb_id,
        "plot": "full" if full_plot else "short",
        "r": "json"
    }

    response = requests.get(BASE_URL, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()

    if data.get("Response") == "False":
        raise ValueError(f"Erreur API OMDb : {data.get('Error', 'ID introuvable')}")

    return data


def search_movies(
    keyword: str,
    page: int = 1,
    movie_type: Optional[str] = None,
    api_key: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Recherche une liste de films par mot-clé (ex: 'Matrix', 'Avatar').
    :param keyword: Mot-clé recherché
    :param page: Numéro de page (10 résultats par page)
    :param movie_type: 'movie', 'series', 'episode' ou None
    """
    params = {
        "apikey": api_key or API_KEY,
        "s": keyword,
        "page": page,
        "r": "json"
    }
    if movie_type:
        params["type"] = movie_type

    response = requests.get(BASE_URL, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()

    if data.get("Response") == "False":
        raise ValueError(f"Erreur recherche OMDb : {data.get('Error', 'Aucun résultat')}")

    return data.get("Search", [])


def print_movie_summary(movie: Dict[str, Any]) -> None:
    """Affiche de manière structurée et lisible les informations clés du film."""
    title = movie.get("Title", "Inconnu")
    year = movie.get("Year", "N/A")
    rating = movie.get("imdbRating", "N/A")
    votes = movie.get("imdbVotes", "N/A")
    plot = movie.get("Plot", "Aucun synopsis disponible")
    director = movie.get("Director", "N/A")
    actors = movie.get("Actors", "N/A")
    genres = movie.get("Genre", "N/A")
    runtime = movie.get("Runtime", "N/A")
    poster = movie.get("Poster", "N/A")
    box_office = movie.get("BoxOffice", "N/A")
    imdb_id = movie.get("imdbID", "N/A")

    print("\n" + "=" * 65)
    print(f"🎬 {title} ({year}) — [IMDb ID: {imdb_id}]")
    print("=" * 65)
    print(f"⭐ Note IMDb        : {rating} / 10")
    print(f"👥 Nombre de votes  : {votes}")
    print(f"⏱️  Durée            : {runtime}")
    print(f"🎭 Genres           : {genres}")
    print(f"🎬 Réalisateur      : {director}")
    print(f"🌟 Acteurs          : {actors}")
    print(f"💰 Box-Office       : {box_office}")
    print(f"🖼️  Affiche          : {poster}")
    print("\n📖 Pitch (Synopsis) :")
    print(f"   {plot}")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    search_query = sys.argv[1] if len(sys.argv) > 1 else "Inception"
    print(f"🔍 Recherche des informations pour : '{search_query}'...")
    
    try:
        # Si c'est un identifiant IMDb (ex: tt1375666)
        if search_query.startswith("tt") and search_query[2:].isdigit():
            movie_data = get_movie_by_imdb_id(search_query)
        else:
            movie_data = get_movie_by_title(search_query)

        print_movie_summary(movie_data)
    except Exception as e:
        print(f"❌ Erreur : {e}")
