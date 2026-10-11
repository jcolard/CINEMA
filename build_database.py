import sys
import io
import os
import re
import json
import time
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
load_dotenv()

OMDB_API_KEY = os.getenv("OMDB_API_KEY", "cd47ed88")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def clean_title_for_omdb(title: str) -> str:
    """Nettoie le titre pour maximiser les chances de correspondance sur OMDb."""
    # Supprimer les sous-titres après : ou -
    t = re.sub(r'[\u2019\']', "'", title)
    t = t.replace("’", "'")
    # Supprimer Extended, 3D, etc.
    t = re.sub(r'\b(Extended|3D|VF|VOST|IMAX|Dolby)\b', '', t, flags=re.I)
    return t.strip()

def search_omdb(title: str, director: str = ""):
    """Cherche sur OMDb par titre direct ou recherche."""
    cleaned = clean_title_for_omdb(title)
    
    # 1. Essai direct avec titre exact
    try:
        r = requests.get("https://www.omdbapi.com/", params={"apikey": OMDB_API_KEY, "t": cleaned, "plot": "full"}, timeout=8).json()
        if r.get("Response") == "True":
            return r
    except Exception as e:
        print(f"OMDb err: {e}")

    # 2. Si le titre a un sous-titre (ex: 'Spider-Man : Brand New Day' -> 'Spider-Man')
    if ":" in cleaned:
        main_part = cleaned.split(":")[0].strip()
        try:
            r = requests.get("https://www.omdbapi.com/", params={"apikey": OMDB_API_KEY, "t": main_part, "plot": "full"}, timeout=8).json()
            if r.get("Response") == "True":
                return r
        except Exception:
            pass

    # 3. Essai par recherche par mot clé
    try:
        s_res = requests.get("https://www.omdbapi.com/", params={"apikey": OMDB_API_KEY, "s": cleaned}, timeout=8).json()
        if s_res.get("Response") == "True" and s_res.get("Search"):
            first_id = s_res["Search"][0].get("imdbID")
            r = requests.get("https://www.omdbapi.com/", params={"apikey": OMDB_API_KEY, "i": first_id, "plot": "full"}, timeout=8).json()
            if r.get("Response") == "True":
                return r
    except Exception:
        pass

    return None

def main():
    print("🚀 Étape 1 : Récupération de la programmation sur Toulourama...")
    url = "https://www.toulourama.fr/"
    resp = requests.get(url, headers=HEADERS)
    resp.encoding = 'utf-8'
    soup = BeautifulSoup(resp.text, "html.parser")

    days_elements = soup.select(".liste-seances .jour")
    print(f"Jours trouvés : {len(days_elements)}")

    movies_dict = {}
    schedule_by_day = []

    for day in days_elements:
        day_id = day.get("data-jour", day.get("id", "unknown"))
        day_title_el = day.select_one("h1 span")
        day_title = day_title_el.get_text(strip=True).lstrip("— ") if day_title_el else day_id

        pathe_seances = day.select(".seance.pathe")
        day_seances = []

        for s in pathe_seances:
            slug = s.get("data-film")
            title_el = s.select_one(".titre-medium, .titre-small")
            title = title_el.get_text(strip=True) if title_el else slug
            time_str = s.select_one(".heure").get_text(strip=True) if s.select_one(".heure") else s.get("data-heure", "")
            cinema = s.select_one(".cinema").get_text(strip=True) if s.select_one(".cinema") else "Pathé Wilson"
            version = s.select_one(".version").get_text(strip=True) if s.select_one(".version") else "VF"
            duree = s.select_one(".duree").get_text(strip=True) if s.select_one(".duree") else ""
            realisateur = s.select_one(".realisateur").get_text(strip=True) if s.select_one(".realisateur") else ""
            affiche = s.get("data-affiche", "")
            image = s.get("data-image", "")
            fiche_pathe = s.get("data-fiche-film", "")
            booking_btn = s.select_one("a.reservation")
            booking_url = booking_btn.get("href") if booking_btn else ""
            film_page_url = f"https://www.toulourama.fr/film/{slug}/"

            if slug not in movies_dict:
                movies_dict[slug] = {
                    "id": slug,
                    "title": title,
                    "director": realisateur,
                    "duration": duree,
                    "poster_toulourama": affiche,
                    "backdrop": image,
                    "fiche_pathe": fiche_pathe,
                    "film_page_url": film_page_url,
                    "synopsis": "",
                    "cast": "",
                    "genre": "",
                    "imdb": None,
                    "seances": []
                }

            seance_data = {
                "day_id": day_id,
                "day_title": day_title,
                "time": time_str,
                "cinema": cinema,
                "version": version,
                "booking_url": booking_url
            }
            movies_dict[slug]["seances"].append(seance_data)
            day_seances.append({
                "film_id": slug,
                "title": title,
                **seance_data
            })

        schedule_by_day.append({
            "day_id": day_id,
            "day_title": day_title,
            "seances": day_seances
        })

    print(f"🎬 {len(movies_dict)} films uniques détectés.")

    print("\n🔍 Étape 2 : Récupération des synopsis Toulourama et enrichissement OMDb/IMDb...")
    for idx, (slug, movie) in enumerate(movies_dict.items(), start=1):
        print(f"[{idx}/{len(movies_dict)}] Traitement de : {movie['title']}...")
        
        # 1. Scrape Toulourama movie page for authentic French synopsis and details
        try:
            f_resp = requests.get(movie["film_page_url"], headers=HEADERS, timeout=6)
            f_resp.encoding = 'utf-8'
            f_soup = BeautifulSoup(f_resp.text, "html.parser")
            synopsis_el = f_soup.select_one("p.synopsis")
            if synopsis_el:
                syn_text = synopsis_el.get_text(strip=True)
                syn_text = re.sub(r'\.\.\.\s*Lire la suite$', '', syn_text).strip()
                movie["synopsis"] = syn_text
            
            details_el = f_soup.select_one("p.details-supp")
            if details_el:
                det_text = details_el.get_text(strip=True)
                movie["genre"] = det_text
        except Exception as e:
            print(f"   ⚠️ Erreur page film: {e}")

        # 2. Enrich with OMDb API
        omdb_data = search_omdb(movie["title"], movie["director"])
        if omdb_data:
            rating_val = omdb_data.get("imdbRating", "N/A")
            votes_val = omdb_data.get("imdbVotes", "N/A")
            imdb_id = omdb_data.get("imdbID", "")
            imdb_plot = omdb_data.get("Plot", "")
            poster_omdb = omdb_data.get("Poster", "")
            
            movie["imdb"] = {
                "imdb_id": imdb_id,
                "rating": rating_val if rating_val != "N/A" else None,
                "votes": votes_val if votes_val != "N/A" else None,
                "plot_en": imdb_plot if imdb_plot != "N/A" else "",
                "poster": poster_omdb if poster_omdb != "N/A" else "",
                "metascore": omdb_data.get("Metascore", "N/A"),
                "year": omdb_data.get("Year", ""),
                "actors": omdb_data.get("Actors", ""),
                "omdb_title": omdb_data.get("Title", "")
            }
            print(f"   ⭐ OMDb: {rating_val}/10 ({votes_val} votes) [ID: {imdb_id}]")
        else:
            print("   ℹ️ Aucun match OMDb direct trouvé.")
        
        # Petit délai de courtoisie
        time.sleep(0.1)

    # Save to JSON
    database = {
        "source": "Toulourama (Pathé) + OMDb API (IMDb)",
        "updated_at": "2026-10-11T16:55:00",
        "cinema_filter": "pathe",
        "movies": list(movies_dict.values()),
        "days": schedule_by_day
    }

    output_json = "movies_database.json"
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(database, f, ensure_ascii=False, indent=2)
    print(f"\n✅ Base de données brute générée dans '{output_json}' ({len(movies_dict)} films)")

    # Exporter aussi en fichier JS directement importable par l'app vanilla
    output_js = "movies_data.js"
    with open(output_js, "w", encoding="utf-8") as f:
        f.write("// Base de données générée automatiquement depuis Toulourama (Pathé) et IMDb/OMDb\n")
        f.write("window.CINEMA_DATA = ")
        json.dump(database, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    print(f"✅ Données JS prêtes pour le frontend dans '{output_js}'")

if __name__ == "__main__":
    main()
