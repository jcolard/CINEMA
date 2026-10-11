# 🎬 CinéMatch — Pathé Wilson Toulouse

Application web mobile-first (Vanilla JS / HTML / CSS) pour découvrir et trier les films à l'affiche au Pathé Wilson (Toulouse) façon Tinder, avec synchronisation dynamique sur la programmation cinéma.

---

## 🌟 Fonctionnalités Implémentées

1. **🎴 Vue "Découvrir" (Tinder du Ciné)** :
   * Pile de cartes animées avec affiches, note officielle IMDb, nombre de votes, durée et pitch/synopsis complet.
   * Clic sur l'affiche ou bouton ▶️ : lance la bande-annonce en modal (**Rickroll par défaut**).
   * **Gestes tactiles et boutons** :
     * 💚 **Swiper à droite / J'aime** : ajoute aux films d'intérêt.
     * ❌ **Swiper à gauche / Passer** : ignore le film.
     * 👁️ **Bouton "Déjà vu"** : marque le film comme vu.
     * ⏭️ **Bouton "Neutre"** : reporte le film en fin de pile sans décision définitive.
   * **Règle stricte** : Tout film swipé (aimé ou rejeté) ou marqué "déjà vu" disparaît automatiquement de la pile de cartes !

2. **📅 Vue "Séances Pathé" (Style Toulourama)** :
   * Affiche la programmation complète jour par jour (Dimanche 11, Lundi 12, Mardi 13 octobre...).
   * **Code couleur instantané selon vos choix LocalStorage** :
     * 🟢 **Vert** : Films qui vous intéressent (swipés à droite).
     * 🔴 **Rouge** : Films rejetés (swipés à gauche).
     * 👁️ **Grisé / Badge Vu** : Films déjà vus.
     * ⚪ **Défaut** : Films pas encore swipés.
   * Filtres rapides : *Tous*, *💚 Mes choix*, *Masquer vus*.
   * Horaires, format (VF/VOST), durée et lien direct de réservation Pathé.

3. **⭐ Vue "Mes Films"** :
   * Tableau de bord récapitulant vos statistiques (aimés, vus, rejetés).
   * Possibilité de retirer un film d'une catégorie pour le remettre dans le deck.
   * Bouton de réinitialisation complète du `localStorage`.

---

## 🚀 Lancer l'Application

Le serveur local est actuellement actif sur le port 8080 :
👉 **[http://localhost:8080](http://localhost:8080)**

Pour relancer le serveur manuellement à tout moment :
```bash
python -m http.server 8080
```

---

## 🔄 Mettre à jour la base de données brute (Scraping Toulourama + OMDb)

Pour rafraîchir les séances et enrichir à nouveau avec l'API OMDb/IMDb :
```bash
python build_database.py
```
Ce script :
1. Scrape en direct toutes les séances Pathé sur `https://www.toulourama.fr/#c=pathe`.
2. Récupère le synopsis officiel en français sur la page de chaque film.
3. Interroge l'API OMDb avec votre clé personnelle pour récupérer les notes et votes IMDb.
4. Génère `movies_database.json` et `movies_data.js`.
