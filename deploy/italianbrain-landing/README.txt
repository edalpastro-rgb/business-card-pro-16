italianbrain.it — landing statica (index.html + style.css + og-preview.png [anteprima OG] + favicon.svg)
Permessi: chmod 644 /var/www/italianbrain/*  (nginx deve poter leggere og-preview.png)

DEPLOY SU NGINX (VPS):
  mkdir -p /var/www/italianbrain
  tar xzf italianbrain-landing.tgz -C /tmp && cp /tmp/italianbrain-landing/{index.html,style.css,og-preview.png,og-image.png,favicon.svg} /var/www/italianbrain/
  cp /tmp/italianbrain-landing/nginx-italianbrain.conf /etc/nginx/conf.d/italianbrain.conf
  nginx -t && systemctl reload nginx
  certbot --nginx -d italianbrain.it -d www.italianbrain.it     # HTTPS (gli OG richiedono URL https raggiungibili)

VIDEO: sostituisci i due blocchi <video ...> (id video-advisoros / video-axonos) con l'iframe Vimeo:
  <iframe src="https://player.vimeo.com/video/ID?dnt=1" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen title="AdvisorOS"></iframe>
  e rimuovi la <span class="video-label">.

ANTEPRIME WhatsApp/Telegram: dopo il deploy verifica con https://developers.facebook.com/tools/debug/ oppure inviando il link a te stesso.
Telegram: @WebpageBot → /start → incolla l'URL per forzare l'aggiornamento della cache.

OG DINAMICA (V50.z536): /og-preview.png è servita dal backend Axon Core (GET /api/public/og-preview.png) con il contatore
«Solo N posti Founder rimasti», rigenerato ogni notte alle 03:05 (o dal CMS › «Rigenera ora»). nginx-italianbrain.conf fa
proxy_pass verso axon-core:8001 (stesso docker-compose); se il backend non risponde serve il PNG statico del pacchetto.
Dopo aver aggiornato la conf: docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
