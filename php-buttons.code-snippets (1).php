<?php

/**
 * php buttons
 */
/**
 * OGB Buttons — SNIPPET (shortcode + modal + AJAX)
 * Pegar en Code Snippets (Run everywhere / Front-end)
 */
if (!defined('ABSPATH')) exit;

/* ---------- 1) Encolar CSS + JS inline ---------- */
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_script('jquery');

    // === CSS (grid + botones + modal) ===
    $css = <<<'CSS'
.ogb-grid{display:grid;gap:16px;grid-template-columns:repeat(3,minmax(0,1fr))}
@media(max-width:1024px){.ogb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.ogb-grid{grid-template-columns:repeat(1,minmax(0,1fr))}}
.ogb-grid .wp-block-stackable-button .stk-button{
  background:transparent!important;color:#009de0!important;border:1px solid #009de0!important;border-radius:5px!important;
  font-weight:bold!important;padding:10px 20px!important;font-size:16px!important;box-shadow:3px 3px 10px 0 #1c355e!important;
  transition:all .3s ease!important;display:flex!important;justify-content:left!important;align-items:left!important;
  text-align:flex-start!important;height:80%!important;text-decoration:none!important
}
.ogb-grid .wp-block-stackable-button .stk-button:hover{box-shadow:6px 6px 20px 0 #1c355e!important;background-color:#f0f4ff!important}
.ogb-grid .stk-button__inner-text{margin-left:8px!important;display:inline-block!important}

/* Modal */
#ogb-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:999999}
#ogb-modal[aria-hidden="false"]{display:flex}
#ogb-modal .ogb-modal__backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}

/* tarjeta del modal (más alta para que entre la barra del reporte) */
#ogb-modal .ogb-modal__card{
  position:relative;
  width:min(96vw,1100px);
  height:min(94vh,820px);   /* <-- antes: min(90vh,760px) */
  background:#fff;
  border-radius:12px;
  overflow:hidden;
  box-shadow:0 10px 30px rgba(0,0,0,.35);
  display:flex;
  flex-direction:column;
}

/* fullscreen un poco más alto para asegurar la barra */
#ogb-modal .ogb-modal__card.is-full{
  width:98vw;
  height:98vh;  /* antes 96vh */
  border-radius:0;
}

/* cabecera y controles */
#ogb-close{
  position:absolute;top:8px;right:8px;z-index:2;border:0;background:#fff;border-radius:50%;
  width:36px;height:36px;box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:pointer;font-size:20px
}

/* cabecera: deja hueco para botones y no tape el contenido */
.ogb-modal-head{
  position:relative;
  z-index:1;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:10px 56px 10px 12px;
  border-bottom:1px solid #eee;
}

#ogb-heading{font-size:16px;margin:0}
#ogb-full{
  border:1px solid #ddd;background:#f8f9fa;border-radius:6px;padding:6px 10px;cursor:pointer;
  line-height:1;min-width:38px;display:inline-flex;align-items:center;justify-content:center
}

/* área de contenido (flex + min-height:0 + overflow:auto) */
#ogb-iframe-wrap{
  display:flex;                 /* contenedor flex real */
  flex-direction:column;
  height:100%;
  min-height:0;                 /* clave para que el hijo pueda usar todo el alto */
  overflow:auto;                /* si falta un poco de alto, aparece scroll y se ve la barra */
}
#ogb-iframe-wrap.ogb-pbi-crop { overflow: hidden !important; }
#ogb-iframe-wrap.ogb-pbi-crop iframe#ogb-iframe { height: calc(100% + 38px) !important; min-height: calc(100% + 38px) !important; max-height: none !important; }

/* Si jQuery hizo .show() y puso display:block inline, lo forzamos a flex */
#ogb-iframe-wrap[style*="display: block"]{ display:flex !important; }

/* iframe ocupa todo el alto disponible del wrap */
#ogb-iframe{
  display:block;          /* evita gap por línea base */
  flex:1;                 /* ocupa todo el alto disponible */
  width:100%;
  height:100%;
  border:0;
  min-height:500px;       /* un poco más alto para asegurar la barra */
}

/* formulario de solicitud */
#ogb-form-wrap{display:none;padding:16px}
#ogb-form-wrap form{display:grid;gap:10px}
#ogb-form-ok{color:green;display:none}
CSS;

    wp_register_style('ogb-inline-style', false);
    wp_enqueue_style('ogb-inline-style');
    wp_add_inline_style('ogb-inline-style', $css);

 // === JS (flujo v0.2.0: sin sessionStorage, sin auto-open) ===
$js = <<<'JS'
jQuery(function($){
  var $modal = $('#ogb-modal'), $card=$('#ogb-modal-card'), $iframeW=$('#ogb-iframe-wrap'),
      $formW=$('#ogb-form-wrap'), $iframe=$('#ogb-iframe'), $head=$('#ogb-heading');

  // === Tracking de clics (Apps Script Web App) ===
  // URL de despliegue:
  var OGB_TRACK_ENDPOINT = 'https://script.google.com/macros/s/AKfycbz3_C8LteAorSKKlauLQVsD7UOJpL0FjKk-WXG4S-JnbY9uOg3xn8_3rgHJ9xGos7_R2g/exec';
  var _ogbTrackOnce = {};

  function ogbTrack(buttonId, buttonName, username, displayName){
    try{
      if(!OGB_TRACK_ENDPOINT) return;
      var key = String(buttonId||buttonName||'');
      if(_ogbTrackOnce[key]) return;
      _ogbTrackOnce[key] = true;
      setTimeout(function(){ delete _ogbTrackOnce[key]; }, 3000);
      var user  = username   || 'visitante';
      var name  = displayName|| username || 'Visitante';
      var btn   = buttonName || buttonId || '';
      var payload = new URLSearchParams({ user:user, name:name, button:btn });
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type:'application/x-www-form-urlencoded;charset=UTF-8' });
        navigator.sendBeacon(OGB_TRACK_ENDPOINT, blob);
      } else {
        fetch(OGB_TRACK_ENDPOINT, { method:'POST', body:payload });
      }
    }catch(e){ /* no-op */ }
  }

  function openModal(){ $modal.attr('aria-hidden','false').css('display','flex'); }
  function closeModal(){ $iframe.attr('src','about:blank'); $modal.attr('aria-hidden','true').hide(); $iframeW.hide().removeClass('ogb-pbi-crop'); $formW.hide(); }
  function setLoading($btn,on){
    if(!$btn||!$btn.length) return;
    if(on){ $btn.data('ogb-old-html',$btn.html()); $btn.html('<span class="stk--inner-svg">⏳</span><span class="stk-button__inner-text">Cargando...</span>'); $btn.attr('aria-busy','true'); }
    else { $btn.html($btn.data('ogb-old-html')||$btn.html()); $btn.removeAttr('aria-busy'); }
  }

  // cerrar modal + fullscreen
  $(document).on('click','[data-ogb-close], .ogb-modal__backdrop',function(e){e.preventDefault();closeModal();});
  $(document).on('keydown',function(e){ if(e.key==='Escape' && $modal.attr('aria-hidden')==='false'){ closeModal(); }});

  // --- Ocultar barra/tabs de Power BI en el URL (se usará solo si el host es powerbi.com) ---
  function ogbEnsurePBIToolbar(url){
    try{
      var u = new URL(url, window.location.origin);
      u.searchParams.set('chromeless', 'true');
      u.searchParams.set('navContentPaneEnabled', 'false');
      u.searchParams.set('filterPaneEnabled', 'false');
      u.searchParams.set('displayMode', 'fitToPage');
      return u.toString();
    }catch(e){
      var sep = url.indexOf('?')>-1 ? '&' : '?';
      return url + sep + 'chromeless=true&navContentPaneEnabled=false&filterPaneEnabled=false&displayMode=fitToPage';
    }
  }

  // --- Normaliza URLs de Looker Studio para que sean embebibles ---
  function ogbFixLookerUrl(url){
    try{
      var u = new URL(url, window.location.origin);
      if (u.hostname.includes('lookerstudio.google.com')) {
        if (!/\/embed\//.test(u.pathname)) {
          u.pathname = u.pathname.replace('/reporting/', '/embed/reporting/');
        }
      }
      return u.toString();
    }catch(e){
      return url.replace('/reporting/', '/embed/reporting/');
    }
  }

  // --- Normaliza URLs de hojas de cálculo para embeber (Sheets / Excel Online) ---
  function ogbFixSheetUrl(url){
    try{
      var u = new URL(url, window.location.origin);
      var h = u.hostname;

      // Google Sheets
      if (h.includes('docs.google.com') && u.pathname.includes('/spreadsheets/')) {
        if (!u.pathname.includes('/pubhtml')) {
          var m = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
          var id = m ? m[1] : null;
          var gid = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1] || '0';
          if (id) {
            u.pathname = '/spreadsheets/d/' + id + '/pubhtml';
            u.search = '';
            u.hash = '';
            u.searchParams.set('gid', gid);
            u.searchParams.set('single', 'true');
            u.searchParams.set('widget', 'true');
            u.searchParams.set('headers', 'false');
          }
        }
        return u.toString();
      }

      // Excel Online / OneDrive
      if (h.includes('onedrive.live.com') || h.includes('office.live.com') || h.includes('1drv.ms')) {
        if (!/(\?|&)resid=/.test(u.search) && /embed/.test(u.pathname)) {
          return u.toString();
        }
        u.pathname = u.pathname.replace(/\/view\.aspx/i, '/embed');
        if (!u.searchParams.has('em')) u.searchParams.set('em', '2');
        return u.toString();
      }

      return url;
    }catch(e){
      if (/docs\.google\.com\/spreadsheets\/.*\/edit/.test(url)) {
        return url.replace(/\/edit.*$/, '/pubhtml?widget=true&headers=false&single=true');
      }
      if (/onedrive\.live\.com\/.*view\.aspx/.test(url)) {
        return url.replace('/view.aspx', '/embed') + (url.includes('?') ? '&' : '?') + 'em=2';
      }
      return url;
    }
  }

  // click en botones
  $(document).on('click', '.ogb-grid a.stk-link', function(e){
    e.preventDefault();
    var $a      = $(this),
        id      = $a.data('button-id'),
        name    = $a.data('button-name') || '',
        heading = $a.data('heading')     || name,
        src     = $a.data('iframe')      || '',
        req     = String($a.data('require-login')||'0') === '1' || String($a.data('require-login')).toLowerCase()==='true',
        allowed = ($a.data('allowed-users')||'').trim();
		gestorExterno = ($a.data('gestor-externo') || '').toString().trim();

    setLoading($a,true);

    $.post(OGB.ajaxurl, {
      action: 'check_user_access',
      _ajax_nonce: OGB.nonce,
      allowed_users: allowed,
      button_id: id || '',
      require_login: req ? '1' : '0'
    }, function(resp){
      setLoading($a,false);

      if(!resp || resp.success !== true || !resp.data){
        alert((resp && resp.data) ? resp.data : 'Error verificando acceso.');
        return;
      }
      var d = resp.data;

      // no logueado + requiere login => redirigir
      if(!d.isLoggedIn && req){
        var login = OGB.loginUrl || '/iniciar-sesion/',
            sep   = login.indexOf('?')>-1 ? '&' : '?',
            ret   = window.location.href;
        window.location.href = login + sep + 'redirect_to=' + encodeURIComponent(ret);
        return;
      }

      // logueado => abrir o mostrar solicitud
      if(d.hasAccess){
  if(src){

    // Si es gestor externo, abrir en nueva pestaña
    if (gestorExterno) {
      ogbTrack(
        id,
        name,
        d.username || d.email || 'visitante',
        d.displayName || d.username || 'Visitante'
      );
      window.open(src, '_blank', 'noopener,noreferrer');
      return;
    }
          $head.text(heading);
          $formW.hide();
          $iframeW.show();

          // 1) Normalizo si es Sheets/Excel
          var finalSrc = ogbFixSheetUrl(src);

          // 2) Normalizo Looker si aplica (no afecta hojas)
          finalSrc = ogbFixLookerUrl(finalSrc);

          // 3) (Opcional) Power BI helper — aplicarlo solo si es powerbi.com
          try {
            var host = new URL(finalSrc, window.location.origin).hostname;
            if (/(\.|^)powerbi\.com$/.test(host)) {
              finalSrc = ogbEnsurePBIToolbar(finalSrc);
              $iframeW.addClass('ogb-pbi-crop');
            } else {
              $iframeW.removeClass('ogb-pbi-crop');
            }
          } catch(e){ /* no-op */ }

          // --- Reset general antes de casos específicos ---
          $iframe
            .attr('referrerpolicy','no-referrer')
            .attr(
              'sandbox',
              'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
            );

          // 4) Ajustes de sandbox si es Sheets o Excel
          if (
            (finalSrc.indexOf('docs.google.com') !== -1 && finalSrc.indexOf('/spreadsheets/') !== -1) ||
            finalSrc.indexOf('onedrive.live.com') !== -1 ||
            finalSrc.indexOf('office.live.com') !== -1 ||
            finalSrc.indexOf('1drv.ms') !== -1
          ) {
            $iframe.attr(
              'sandbox',
              'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation'
            );
          }

          // 5) Si es Looker, aflojar referrer y sandbox
          if (finalSrc.indexOf('lookerstudio.google.com') !== -1) {
            $iframe.removeAttr('referrerpolicy');
            $iframe.attr(
              'sandbox',
              'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation'
            );
          }

          // 6) Cargar el src
          $iframe.attr('src', finalSrc);

          // --- TRACKEO de clic con acceso ---
          ogbTrack(
            id,
            name,
            d.username || d.email || 'visitante',
            d.displayName || d.username || 'Visitante'
          );

          openModal();
        }else{
          console.warn('[OGB] Falta data-iframe en botón', id);
        }
      }else{
        $('#ogb-form-button-id').val(id || '');
        $('#ogb-form-button-name').val(name || '');

        var solicitante = d.username || d.email || '';
        $('#ogb-form-user')
          .val(solicitante)
          .prop('readonly', true)
          .attr('aria-readonly', 'true');

        $iframeW.hide();
        $formW.show();
        $head.text('Solicitud de acceso');
        openModal();

        // --- TRACKEO de intento sin acceso ---
        ogbTrack(
          id,
          name + ' (sin acceso)',
          d.username || d.email || 'visitante',
          d.displayName || d.username || 'Visitante'
        );
      }

    }, 'json').fail(function(){
      setLoading($a,false);
      alert('No se pudo conectar con el servidor para verificar acceso.');
    });
  });

  // envío de solicitud de acceso
  $('#ogb-form').on('submit',function(e){
    e.preventDefault();
    var payload={
      action:'solicitud_acceso', _ajax_nonce:OGB.nonce,
      nombre_usuario:$('#ogb-form-user').val(),
      nombre_boton:$('#ogb-form-button-name').val(),
      motivo:$('#ogb-form-motivo').val(),
      button_id:$('#ogb-form-button-id').val()
    };
    $.post(OGB.ajaxurl,payload,function(resp){
      if(resp&&resp.success){
        $('#ogb-form-ok').show();
        setTimeout(function(){ $('#ogb-form-ok').hide(); $('#ogb-form')[0].reset(); closeModal(); },1500);
      }else{
        alert((resp&&resp.data&&resp.data.message)?resp.data.message:'No se pudo enviar la solicitud');
      }
    },'json').fail(function(){ alert('Error en la conexión al enviar la solicitud.'); });
  });

  // Fullscreen: asegurar un solo handler
  $(document)
    .off('click.ogbFull', '#ogb-full')
    .on('click.ogbFull', '#ogb-full', function (e) {
      e.preventDefault();
      $('#ogb-modal-card').toggleClass('is-full');
      var pressed = $(this).attr('aria-pressed') === 'true';
      $(this).attr('aria-pressed', (!pressed).toString());
    });

});
JS;


    wp_register_script('ogb-inline-js', false, ['jquery'], null, true);
    wp_enqueue_script('ogb-inline-js');
    wp_add_inline_script('ogb-inline-js', $js);

    // Vars para JS (ajax público + login público)
    wp_localize_script('ogb-inline-js', 'OGB', [
        'ajaxurl'    => site_url('/wp-admin/admin-ajax.php'), // público (no admin_url)
        'nonce'      => wp_create_nonce('ogb_nonce'),
        'loginUrl'   => site_url('/iniciar-sesion/'),
    ]);
});

/* ---------- 2) Fetch items (endpoint con cache simple) ---------- */
function ogb_fetch_items($endpoint) {
    $cache_minutes = isset($GLOBALS['OGB_CACHE_MINUTES']) ? max(0, intval($GLOBALS['OGB_CACHE_MINUTES'])) : 10;
    $key = 'ogb_items_' . md5($endpoint);

    if ($cache_minutes > 0) {
        $cached = get_transient($key);
        if ($cached !== false) return $cached;
    } else {
        delete_transient($key);
    }

    $res = wp_remote_get($endpoint, ['timeout' => 12]);
    if (is_wp_error($res)) return [];

    $body  = json_decode(wp_remote_retrieve_body($res), true);
    $items = $body['items'] ?? [];

    $norm = [];
    foreach ($items as $it) {
        if (empty($it['id']) || empty($it['titulo'])) continue;

        $norm[] = [
            'id'              => $it['id'],
            'titulo'          => $it['titulo'],
            'icono'           => $it['icono'] ?? '🔗',
            'categoria'       => $it['categoria'] ?? '',
            'gestor'          => $it['gestor'] ?? '',
            'gestor_externo'  => $it['gestor_externo'] ?? '',
            'orden'           => isset($it['orden']) ? intval($it['orden']) : 0,
            'heading_iframe'  => $it['heading_iframe'] ?? '',
            'iframe_src'      => $it['iframe_src'] ?? '',
            'require_login'   => !empty($it['require_login']),
            'enabled'         => !empty($it['enabled']),
            'allowed_users'   => $it['allowed_users'] ?? '',
        ];
    }

    // solo activos + orden
    $norm = array_values(array_filter($norm, fn($x) => !empty($x['enabled'])));
    usort($norm, fn($a, $b) => ($a['orden'] <=> $b['orden']));

    if ($cache_minutes > 0) {
        set_transient($key, $norm, $cache_minutes * MINUTE_IN_SECONDS);
    }

    return $norm;
}

/* ---------- 3) Shortcode ---------- */
add_shortcode('og_buttons', function($atts) {
    $atts = shortcode_atts([
        'endpoint' => '',
        'tax'      => 'auto', // categoria | gestor | gestor_externo | auto
        'value'    => '',
        'class'    => '',
        'match'    => 'any',  // any | both (solo para auto)
        'use_slug' => '0',
        'cache'    => '10'
    ], $atts, 'og_buttons');

    if (empty($atts['endpoint'])) {
        return '<div style="color:red">Falta el atributo <b>endpoint</b>.</div>';
    }

    $GLOBALS['OGB_CACHE_MINUTES'] = max(0, intval($atts['cache']));
    $items = ogb_fetch_items(esc_url_raw($atts['endpoint']));

    // target (value | slug | title)
    $current = $atts['value'];
    if ($current === '') {
        $current = ($atts['use_slug'] === '1')
            ? sanitize_title(get_post_field('post_name', get_queried_object_id()))
            : get_the_title(get_queried_object_id());
    }

    $normalize = function($s) use ($atts) {
        $s = trim((string)$s);
        return ($atts['use_slug'] === '1') ? sanitize_title($s) : $s;
    };

    $target = $normalize($current);

    // split helper (soporta multiples valores en hoja: a,b|c)
    $split = function($raw) use ($normalize) {
        $arr = preg_split('~[,\|]~', (string)$raw);
        $arr = array_filter(array_map(fn($x) => $normalize(trim($x)), $arr));
        return $arr;
    };

    $tax   = in_array($atts['tax'], ['categoria', 'gestor', 'gestor_externo', 'auto'], true) ? $atts['tax'] : 'auto';
    $match = ($atts['match'] === 'both') ? 'both' : 'any';

    // filtrar
    $items = array_values(array_filter($items, function($it) use ($tax, $target, $split, $match) {
        $cats = $split($it['categoria'] ?? '');
        $gess = $split($it['gestor'] ?? '');
        $gext = $split($it['gestor_externo'] ?? '');

        if ($tax === 'categoria') return in_array($target, $cats, true);
        if ($tax === 'gestor') return in_array($target, $gess, true);
        if ($tax === 'gestor_externo') return in_array($target, $gext, true);

        $inCat  = in_array($target, $cats, true);
        $inGes  = in_array($target, $gess, true);
        $inGext = in_array($target, $gext, true);

        return ($match === 'both')
            ? ($inCat && $inGes) || ($inCat && $inGext) || ($inGes && $inGext)
            : ($inCat || $inGes || $inGext);
    }));

    if (!$items) return '<div>No hay botones para mostrar.</div>';

    ob_start(); ?>
    <div class="ogb-grid <?php echo esc_attr($atts['class']); ?>" data-endpoint="<?php echo esc_url($atts['endpoint']); ?>">
      <?php foreach ($items as $it): ?>
        <div class="wp-block-stackable-button stk-block-button is-style-ghost stk-block stk-<?php echo esc_attr($it['id']); ?>" data-block-id="<?php echo esc_attr($it['id']); ?>">
          <a class="stk-link stk-button stk--hover-effect-lift-scale"
   href="javascript:void(0);"
   data-button-id="<?php echo esc_attr($it['id']); ?>"
   data-button-name="<?php echo esc_attr($it['titulo']); ?>"
   data-heading="<?php echo esc_attr($it['heading_iframe']); ?>"
   data-iframe="<?php echo esc_url($it['iframe_src']); ?>"
   data-require-login="<?php echo !empty($it['require_login']) ? '1' : '0'; ?>"
   data-allowed-users="<?php echo esc_attr($it['allowed_users'] ?? ''); ?>"
   data-gestor-externo="<?php echo esc_attr($it['gestor_externo'] ?? ''); ?>">
            <span class="stk--svg-wrapper">
              <span class="stk--inner-svg" style="font-size:26px;">
                <?php if (preg_match('~^https?://~', $it['icono'])): ?>
                  <img src="<?php echo esc_url($it['icono']); ?>" alt="" style="width:1em;height:1em;vertical-align:middle;">
                <?php else: echo esc_html($it['icono']); endif; ?>
              </span>
            </span>
            <span class="has-text-color stk-button__inner-text"><?php echo esc_html($it['titulo']); ?></span>
          </a>
        </div>
      <?php endforeach; ?>
    </div>
    <?php
    return ob_get_clean();
});

/* ---------- 4) Modal único en footer ---------- */
add_action('wp_footer', function () {
    if (is_admin()) return; ?>
    <div class="ogb-modal" id="ogb-modal" aria-hidden="true" role="dialog" aria-label="Contenido">
      <div class="ogb-modal__backdrop" data-ogb-close></div>
      <div class="ogb-modal__card" id="ogb-modal-card">
        <button class="ogb-close" id="ogb-close" aria-label="Cerrar" data-ogb-close>×</button>

        <div id="ogb-iframe-wrap">
          <div class="ogb-modal-head">
            <h2 id="ogb-heading"></h2>
            <button id="ogb-full" class="ogb-full" type="button" aria-label="Pantalla completa">⛶</button>
          </div>
          <iframe id="ogb-iframe"
        	referrerpolicy="no-referrer"
        	sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        	allowfullscreen
        	loading="lazy"></iframe>
        </div>

        <div id="ogb-form-wrap">
          <h3>No tenés autorización para acceder</h3>
          <p>Completá el formulario para solicitar acceso:</p>
          <form id="ogb-form">
            <input type="hidden" id="ogb-form-button-id" name="button_id">
            <input type="text" id="ogb-form-user" name="nombre_usuario" placeholder="Tu usuario o correo" required readonly>
            <input type="text" id="ogb-form-button-name" name="nombre_boton" readonly>
            <textarea id="ogb-form-motivo" name="motivo" placeholder="Motivo de la solicitud" rows="3" required></textarea>
            <button type="submit">Solicitar Acceso</button>
          </form>
          <p id="ogb-form-ok">Solicitud enviada.</p>
        </div>
      </div>
    </div>
<?php });

/* ---------- 5) AJAX: check_user_access ---------- */
add_action('wp_ajax_check_user_access', 'ogb_ajax_check_user_access');
add_action('wp_ajax_nopriv_check_user_access', 'ogb_ajax_check_user_access');
function ogb_ajax_check_user_access(){
    check_ajax_referer('ogb_nonce', '_ajax_nonce');

    $allowed_users_raw = isset($_POST['allowed_users']) ? (string) $_POST['allowed_users'] : '';
    $button_id         = isset($_POST['button_id']) ? sanitize_text_field($_POST['button_id']) : '';
    $require_login     = (isset($_POST['require_login']) && $_POST['require_login'] === '1');

    // Normalizo lista: separadores coma | pipe | punto y coma | saltos de línea
    $list = array_filter(array_map('trim', preg_split('~[,\|\n;]+~', $allowed_users_raw)));
    $list_lower = array_map('strtolower', $list);

    $user      = wp_get_current_user();
    $is_logged = is_user_logged_in();
    $hasAccess = false;

    /* === BYPASS TEMPRANO PARA ADMIN (clave) === */
    if ( $is_logged && ( current_user_can('administrator') || current_user_can('manage_options') || is_super_admin() ) ) {
        wp_send_json_success([
            'isLoggedIn'  => true,
            'hasAccess'   => true,
            'username'    => $user->user_login ?? '',
            'displayName' => $user->display_name ?? '',
            'email'       => $user->user_email ?? '',
            'roles'       => $user->roles ?? [],
        ]);
    }

    // 1) si requiere login y NO está logueado => sin acceso
    if ($require_login && !$is_logged) {
        $hasAccess = false;

    // 2) si requiere login y la lista está vacía => denegado por defecto (política actual)
    //    (Si quisieras que cualquier usuario logueado entre cuando la lista está vacía, cambiá a: $hasAccess = $is_logged;)
    } elseif ($require_login && empty($list)) {
        $hasAccess = false;

    // 3) si NO requiere login y la lista está vacía => libre
    } elseif (!$require_login && empty($list)) {
        $hasAccess = true;

    // 4) hay lista => evaluar email/username/ID
    } else {
        if ($is_logged) {
            $user_email = strtolower($user->user_email ?? '');
            $user_login = strtolower($user->user_login ?? '');
            $user_id    = (string) ($user->ID ?? '');

            // Acepta: email, username o ID numérico tal cual
            if (
                in_array($user_email, $list_lower, true) ||
                in_array($user_login, $list_lower, true) ||
                in_array($user_id, $list, true)
            ) {
                $hasAccess = true;
            } else {
                $hasAccess = false;
            }
        } else {
            $hasAccess = false;
        }
    }

    wp_send_json_success([
        'isLoggedIn'  => $is_logged,
        'hasAccess'   => (bool)$hasAccess,
        'username'    => $user->user_login ?? '',
        'displayName' => $user->display_name ?? '', // ← añadido
        'email'       => $user->user_email ?? '',
        'roles'       => $user->roles ?? [],
    ]);
}

/* ---------- 6) AJAX: solicitud_acceso ---------- */
add_action('wp_ajax_solicitud_acceso', 'ogb_ajax_solicitud_acceso');
add_action('wp_ajax_nopriv_solicitud_acceso', 'ogb_ajax_solicitud_acceso');
function ogb_ajax_solicitud_acceso(){
    check_ajax_referer('ogb_nonce', '_ajax_nonce');

    $nombre_usuario = sanitize_text_field($_POST['nombre_usuario'] ?? '');
    $nombre_boton   = sanitize_text_field($_POST['nombre_boton'] ?? '');
    $motivo         = sanitize_textarea_field($_POST['motivo'] ?? '');
    $button_id      = sanitize_text_field($_POST['button_id'] ?? '');

    if (empty($nombre_usuario) || empty($motivo)) {
        wp_send_json_error(['message' => 'Faltan datos obligatorios.'], 400);
    }

    $entry = [
        'timestamp' => current_time('mysql'),
        'user'      => $nombre_usuario,
        'button'    => $nombre_boton,
        'button_id' => $button_id,
        'motivo'    => $motivo,
        'ip'        => sanitize_text_field($_SERVER['REMOTE_ADDR'] ?? ''),
    ];
    $requests = get_option('ogb_access_requests', []);
    $requests[] = $entry;
    update_option('ogb_access_requests', $requests);

    $sent = wp_mail(
        get_option('admin_email'),
        'Solicitud de acceso OGB: '.($nombre_boton ?: $button_id),
        "Nueva solicitud de acceso:\n\nUsuario: {$nombre_usuario}\nBotón: {$nombre_boton} (id: {$button_id})\nMotivo:\n{$motivo}\n\nIP: {$entry['ip']}\n"
    );

    wp_send_json_success(['message' => $sent ? 'Solicitud enviada.' : 'Solicitud registrada (no se pudo enviar mail).']);
}
