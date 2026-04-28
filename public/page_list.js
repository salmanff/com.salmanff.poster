/* page_list.js — client-side data loader for the public blog list */
document.addEventListener('DOMContentLoaded', function () {
  var container = document.getElementById('posts-container')
  var loadMoreWrap = document.getElementById('load-more-wrap')
  var loadMoreBtn = document.getElementById('btn-load-more')
  var loadingMsg = document.getElementById('loading-msg')

  var owner = (typeof freezrMeta !== 'undefined' && freezrMeta.userId) || ''
  var appName = (typeof freezrMeta !== 'undefined' && freezrMeta.appName) || ''
  var earliestDate = null

  var ownerNameEl = document.getElementById('owner-name')
  if (ownerNameEl && owner) ownerNameEl.textContent = owner

  function escapeHtml (str) {
    if (!str) return ''
    var div = document.createElement('div')
    div.appendChild(document.createTextNode(str))
    return div.innerHTML
  }

  function renderPost (post) {
    var hasImg = !!post.mainimgurl
    var html = '<div style="margin-bottom:32px;">'
    html += '<div style="font-size:22px;font-weight:700;margin-bottom:6px;">'
    html += '<a href="/' + escapeHtml(post._id) + '" style="color:#0891b2;text-decoration:none;">'
    html += escapeHtml(post.title || 'Untitled') + '</a></div>'

    if (hasImg) {
      html += '<div style="display:flex;gap:16px;align-items:flex-start;">'
      html += '<div style="flex:1;min-width:0;">'
    }
    if (post.summaryText) {
      html += '<div style="color:#475569;font-size:15px;line-height:1.65;margin-bottom:10px;">' + escapeHtml(post.summaryText) + '</div>'
    }
    html += '<div style="color:#94a3b8;font-size:12px;">'
    html += 'By ' + escapeHtml(post._data_owner) + ' · ' + escapeHtml(post.__date_published || '')
    if (Array.isArray(post.labels)) {
      post.labels.forEach(function (label) {
        html += '<span style="background:#f1f5f9;border-radius:4px;padding:2px 7px;margin-left:4px;">' + escapeHtml(label) + '</span>'
      })
    }
    html += '</div>'
    if (hasImg) {
      html += '</div>'
      html += '<img src="' + escapeHtml(post.mainimgurl) + '" alt="" style="width:200px;max-height:180px;object-fit:cover;border-radius:8px;flex-shrink:0;" />'
      html += '</div>'
    }
    html += '<div style="margin-top:10px;border-bottom:1px solid #e2e8f0;"></div>'
    html += '</div>'
    return html
  }

  function fetchPosts (beforeDate) {
    var queryOptions = {
      q: {
        owner: owner,
        app: appName,
        doNotList: { $ne: true }
      },
      count: 20
    }
    if (beforeDate) queryOptions.q.published_before = beforeDate

    freezr.publicquery(queryOptions)
      .then(function (data) {
        console.log('page_list fetchPosts - response:', JSON.stringify(data))
        if (loadingMsg) { loadingMsg.remove(); loadingMsg = null }

        var results = (data && data.results) || []
        if (results.length === 0 && !beforeDate) {
          container.innerHTML = '<p style="color:#94a3b8;">No posts published yet.</p>'
          return
        }
        var html = ''
        results.forEach(function (post) {
          html += renderPost(post)
          var ts = post._date_published
          if (ts && (!earliestDate || ts < earliestDate)) earliestDate = ts
        })
        container.insertAdjacentHTML('beforeend', html)

        if (results.length >= 20) {
          loadMoreWrap.style.display = ''
        } else {
          loadMoreWrap.style.display = 'none'
        }
      })
      .catch(function (err) {
        console.error('page_list fetchPosts - catch error:', err)
        if (loadingMsg) { loadingMsg.remove(); loadingMsg = null }
        container.innerHTML = '<p style="color:#ef4444;">Error loading posts.</p>'
      })
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      if (earliestDate) fetchPosts(earliestDate)
    })
  }

  fetchPosts()
})
