# QuickPower ⚡

Un utilitaire simple et élégant pour planifier l'arrêt, le redémarrage ou la mise en veille prolongée de votre PC Windows.

![Screenshot de QuickPower](assets/image.png)

## Fonctionnalités ✨

* **Planification Facile :** Entrez une durée en minutes ou en heures.
* **Mode Sombre/Clair :** Basculez entre les thèmes d'un simple clic.
* **Mémoire Intégrée :** L'application se souvient de l'action programmée, même si vous la fermez.
* **Annulation Simple :** Annulez l'action programmée à tout moment.
* **Interface Moderne :** Design épuré sans cadre de fenêtre natif.

## Comment Lancer (Développement) 🚀

1.  **Prérequis :** Assurez-vous d'avoir [Node.js](https://nodejs.org/) installé.
2.  **Cloner le dépôt :** 
    ```bash
    git clone [https://github.com/depot](https://github.com/depot)
    cd quick-power 
    ```
3.  **Installer les dépendances :**
    ```bash
    npm install
    ```
4.  **Lancer l'application :**
    ```bash
    npm start
    ```

## Comment Créer l'Exécutable (.exe) 📦

1.  **Assurez-vous que les dépendances sont installées :**
    ```bash
    npm install
    ```
2.  **Lancer le build :**

    ⚠️ **Important pour Windows :** En raison de la création de liens symboliques par les outils de build, vous devez lancer cette commande depuis un terminal **exécuté en tant qu'administrateur**. Faites un clic droit sur votre terminal (ou sur VS Code) et choisissez "Exécuter en tant qu'administrateur".

    ```bash
    npm run dist
    ```
3.  **Trouver les fichiers :** L'installateur (`.exe`) ou la version portable se trouveront dans le nouveau dossier `dist/`.
---

Fait avec ❤️ et Electron.