# Footprints on Earth

A local CSV visualization app for footprint/location exports. The app loads data/footprint_test_file.csv as the public demo dataset by default. You can also choose or drag in your own CSV file in the browser for local viewing.

The map uses MapLibre GL JS with OpenStreetMap raster tiles and supports globe/flat map modes, footprint points, route lines, date filtering, a virtualized point list, and optional AMap tiles.

## Run

Node.js is required.

    ./serve.sh

On Windows PowerShell, you can also run:

    .\serve.ps1

Then open:

    http://127.0.0.1:5173/

## CSV Data

The default demo file is:

    data/footprint_test_file.csv

The CSV should include dataTime, longitude, and latitude columns. Optional columns such as speed, distance, altitude, and heading are also read when present.

To avoid accidentally publishing private footprint data, .gitignore ignores other CSV files under data/ and keeps only data/footprint_test_file.csv as the public demo file. For private data, use the in-browser file picker or drag-and-drop flow.

## Features

- OpenStreetMap map tiles
- MapLibre GL JS globe and flat map views
- Footprint points, route lines, and automatic map fitting
- Year, month, day, and time range filtering
- Linked point list and map highlight behavior
- Optional AMap source; the key and security code are stored only in browser localStorage
