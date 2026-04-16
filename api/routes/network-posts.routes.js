'use strict';

const { v2: cloudinary } = require('cloudinary');
const { requireWallet, optionalWallet } = require('../middleware/wallet');
const { Connection, PublicKey } = require('@solana/web3.js');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dm9wn7axz',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

let _ntcMintCache = null;
async function getNtcMintForRoutes() {
  if (_ntcMintCache) return _ntcMintCache;
  try {
    const { query: dbQ } = require('../db/init');
    const result = await dbQ('SELECT mint_address FROM tokens WHERE symbol = $1', ['NTC']);
    if (result.rows.length > 0) {
      _ntcMintCache = result.rows[0].mint_address;
      return _ntcMintCache;
    }
  } catch (e) {
    console.warn('[network-posts] Could not fetch NTC mint:', e.message);
  }
  return null;
}

async function walletHasNtc(walletAddress) {
  try {
    const splToken = require('@solana/spl-token');
    const ntcMintAddr = await getNtcMintForRoutes();
    if (!ntcMintAddr) return false;
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) return false;
    const connection = new Connection(rpcUrl, 'confirmed');
    const mintPk = new PublicKey(ntcMintAddr);
    const walletPk = new PublicKey(walletAddress);
    const mintAcct = await connection.getAccountInfo(mintPk);
    const tokenProgram = mintAcct && mintAcct.owner.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
      ? splToken.TOKEN_2022_PROGRAM_ID
      : splToken.TOKEN_PROGRAM_ID;
    const ata = splToken.getAssociatedTokenAddressSync(mintPk, walletPk, false, tokenProgram);
    const ataInfo = await connection.getAccountInfo(ata);
    if (!ataInfo) return false;
    const tokenAccount = splToken.unpackAccount(ata, ataInfo, tokenProgram);
    return tokenAccount.amount > 0n;
  } catch (e) {
    console.warn('[network-posts] NTC balance check failed:', e.message);
    return false;
  }
}

function registerNetworkPostRoutes(app, getAdminWallets) {
  function getSql() {
    return require('../db/init').getSql();
  }

  async function isAdmin(wallet) {
    if (!wallet) return false;
    const admins = await getAdminWallets();
    return admins.includes(wallet);
  }

  async function getAdminRole(wallet) {
    if (!wallet) return null;
    const s = getSql();
    if (!s) return null;
    try {
      const rows = await s`SELECT role FROM admin_wallets WHERE wallet = ${wallet} LIMIT 1`;
      if (rows.length > 0) return rows[0].role;
    } catch {}
    return null;
  }

  async function hasPostPermission(wallet) {
    if (!wallet) return false;
    if (await isAdmin(wallet)) return true;
    const s = getSql();
    if (!s) return false;
    const rows = await s`SELECT id FROM network_post_permissions WHERE wallet = ${wallet}`;
    return rows.length > 0;
  }

  // List all wallets with network posting permission (admin only)
  app.get('/network-post-permissions', async (request, reply) => {
    try {
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      if (!(await isAdmin(wallet))) return reply.status(403).send({ ok: false, error: 'Admin only' });

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const rows = await s`SELECT * FROM network_post_permissions ORDER BY created_at DESC`;
      return reply.send({ ok: true, permissions: rows });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Grant network posting permission to a wallet (admin only)
  app.post('/network-post-permissions', async (request, reply) => {
    try {
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      if (!(await isAdmin(wallet))) return reply.status(403).send({ ok: false, error: 'Admin only' });

      const { targetWallet } = request.body || {};
      if (!targetWallet || typeof targetWallet !== 'string' || !targetWallet.trim()) {
        return reply.status(400).send({ ok: false, error: 'targetWallet required' });
      }

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const result = await s`
        INSERT INTO network_post_permissions (wallet, granted_by)
        VALUES (${targetWallet.trim()}, ${wallet})
        ON CONFLICT (wallet) DO NOTHING
        RETURNING *
      `;

      if (result.length === 0) {
        const existing = await s`SELECT * FROM network_post_permissions WHERE wallet = ${targetWallet.trim()}`;
        return reply.send({ ok: true, permission: existing[0], alreadyGranted: true });
      }

      return reply.send({ ok: true, permission: result[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Check if the current wallet has network posting permission
  app.get('/network-post-permissions/check', async (request, reply) => {
    try {
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      const permitted = await hasPostPermission(wallet);
      return reply.send({ ok: true, permitted });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Revoke network posting permission from a wallet (admin only)
  app.delete('/network-post-permissions/:targetWallet', async (request, reply) => {
    try {
      const { targetWallet } = request.params;
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      if (!(await isAdmin(wallet))) return reply.status(403).send({ ok: false, error: 'Admin only' });

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      await s`DELETE FROM network_post_permissions WHERE wallet = ${targetWallet}`;
      return reply.send({ ok: true, removed: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  const UPLOAD_SIZE_LIMIT = 150 * 1024 * 1024; // 150 MB — scoped to this route only

  // Upload media to Cloudinary (admin only)
  // Per-route bodyLimit override: only this endpoint accepts large payloads
  app.post('/network-posts/upload', { bodyLimit: UPLOAD_SIZE_LIMIT }, async (request, reply) => {
    try {
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      if (!(await hasPostPermission(wallet))) return reply.status(403).send({ ok: false, error: 'Not permitted' });

      // Override multipart fileSize limit for this route only
      const data = await request.file({ limits: { fileSize: UPLOAD_SIZE_LIMIT } });
      if (!data) return reply.status(400).send({ ok: false, error: 'No file uploaded' });

      const mimeType = data.mimetype || '';
      const isVideo = mimeType.startsWith('video/');
      const isImage = mimeType.startsWith('image/');
      if (!isVideo && !isImage) {
        return reply.status(400).send({ ok: false, error: 'Only image or video files allowed' });
      }

      const resourceType = isVideo ? 'video' : 'image';
      // Stream directly to Cloudinary — avoids loading the entire file into memory
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'network_posts',
            resource_type: resourceType,
          },
          (err, res) => {
            if (err) reject(err);
            else resolve(res);
          }
        );
        data.file.pipe(uploadStream);
        data.file.on('error', reject);
      });

      return reply.send({
        ok: true,
        url: result.secure_url,
        publicId: result.public_id,
        mediaType: isVideo ? 'video' : 'image',
      });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Create a new network post (admin or permitted user)
  app.post('/network-posts', async (request, reply) => {
    try {
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      if (!(await hasPostPermission(wallet))) return reply.status(403).send({ ok: false, error: 'Not permitted' });

      const { title, body, mediaUrl, mediaType, cloudinaryPublicId, category } = request.body || {};
      if (!body && !title) return reply.status(400).send({ ok: false, error: 'title or body required' });

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const result = await s`
        INSERT INTO network_posts
          (author_wallet, title, body, media_url, media_type, cloudinary_public_id, category)
        VALUES
          (${wallet}, ${(title || '').slice(0, 256)}, ${(body || '').slice(0, 10000)},
           ${(mediaUrl || '').slice(0, 1024)}, ${(mediaType || '').slice(0, 10)},
           ${(cloudinaryPublicId || '').slice(0, 256)}, ${(category || 'General').slice(0, 32)})
        RETURNING *
      `;

      return reply.send({ ok: true, post: result[0] });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Update a network post (own post by admin or permitted user)
  app.put('/network-posts/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      if (!(await hasPostPermission(wallet))) return reply.status(403).send({ ok: false, error: 'Not permitted' });

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const existing = await s`SELECT * FROM network_posts WHERE id = ${id}`;
      if (existing.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found' });

      if (existing[0].author_wallet !== wallet) {
        return reply.status(403).send({ ok: false, error: 'You can only edit your own posts' });
      }

      const { title, body, category, mediaUrl, mediaType, cloudinaryPublicId } = request.body || {};

      const newTitle = title !== undefined ? title : existing[0].title || '';
      const newBody = body !== undefined ? body : existing[0].body || '';
      if (!newTitle.trim() && !newBody.trim()) {
        return reply.status(400).send({ ok: false, error: 'title or body required' });
      }

      const result = await s`
        UPDATE network_posts SET
          title = ${newTitle.slice(0, 256)},
          body = ${newBody.slice(0, 10000)},
          category = ${(category !== undefined ? category : existing[0].category || 'General').slice(0, 32)},
          media_url = ${(mediaUrl !== undefined ? mediaUrl : existing[0].media_url || '').slice(0, 1024)},
          media_type = ${(mediaType !== undefined ? mediaType : existing[0].media_type || '').slice(0, 10)},
          cloudinary_public_id = ${(cloudinaryPublicId !== undefined ? cloudinaryPublicId : existing[0].cloudinary_public_id || '').slice(0, 256)},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      const profile = await s`SELECT username, display_name, avatar_url FROM user_profiles WHERE wallet = ${result[0].author_wallet}`;
      const post = {
        ...result[0],
        username: profile[0]?.username || null,
        display_name: profile[0]?.display_name || null,
        avatar_url: profile[0]?.avatar_url || null,
      };

      return reply.send({ ok: true, post });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Get all network posts (public, paginated)
  app.get('/network-posts', async (request, reply) => {
    try {
      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const lim = Math.min(Number(request.query.limit) || 50, 100);
      const off = Number(request.query.offset) || 0;
      const sort = request.query.sort || '';
      const owResult = optionalWallet(request.raw, request.query);
      if (owResult.error) return reply.status(owResult.status).send(owResult.body);
      const viewerWallet = owResult.walletAddress || '';

      let orderClause = s`ORDER BY p.created_at DESC`;
      if (sort === 'top') {
        orderClause = s`ORDER BY p.likes_count DESC, p.created_at DESC`;
      } else if (sort === 'latest') {
        orderClause = s`ORDER BY p.created_at DESC`;
      }

      const posts = await s`
        SELECT
          p.*,
          u.username, u.display_name, u.avatar_url
        FROM network_posts p
        LEFT JOIN user_profiles u ON p.author_wallet = u.wallet
        ${orderClause}
        LIMIT ${lim} OFFSET ${off}
      `;

      let likedPostIds = new Set();
      if (viewerWallet) {
        const likes = await s`
          SELECT post_id FROM network_post_likes WHERE wallet = ${viewerWallet}
        `;
        likedPostIds = new Set(likes.map(l => String(l.post_id)));
      }

      const postsWithLiked = posts.map(p => ({
        ...p,
        liked_by_viewer: likedPostIds.has(String(p.id)),
      }));

      return reply.send({ ok: true, posts: postsWithLiked });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Get single network post
  app.get('/network-posts/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const owResult = optionalWallet(request.raw, request.query);
      if (owResult.error) return reply.status(owResult.status).send(owResult.body);
      const viewerWallet = owResult.walletAddress || '';

      const result = await s`
        SELECT p.*, u.username, u.display_name, u.avatar_url
        FROM network_posts p
        LEFT JOIN user_profiles u ON p.author_wallet = u.wallet
        WHERE p.id = ${id}
      `;
      if (result.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found' });

      let liked_by_viewer = false;
      if (viewerWallet) {
        const likeCheck = await s`
          SELECT id FROM network_post_likes WHERE post_id = ${id} AND wallet = ${viewerWallet}
        `;
        liked_by_viewer = likeCheck.length > 0;
      }

      return reply.send({ ok: true, post: { ...result[0], liked_by_viewer } });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Delete network post (admin can delete any, permitted user can delete own)
  app.delete('/network-posts/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;
      if (!(await hasPostPermission(wallet))) return reply.status(403).send({ ok: false, error: 'Not permitted' });

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const existing = await s`SELECT cloudinary_public_id, media_type, author_wallet FROM network_posts WHERE id = ${id}`;
      if (existing.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found' });

      const adminCheck = await isAdmin(wallet);
      if (adminCheck) {
        const role = await getAdminRole(wallet);
        if (role === 'admin' && existing[0].author_wallet !== wallet) {
          return reply.status(403).send({ ok: false, error: 'Regular admins can only delete their own posts' });
        }
      } else if (existing[0].author_wallet !== wallet) {
        return reply.status(403).send({ ok: false, error: 'You can only delete your own posts' });
      }

      const { cloudinary_public_id, media_type } = existing[0];

      // Delete from Cloudinary if asset exists
      if (cloudinary_public_id) {
        try {
          const resourceType = media_type === 'video' ? 'video' : 'image';
          await cloudinary.uploader.destroy(cloudinary_public_id, { resource_type: resourceType });
        } catch (e) {
          console.warn('[network-posts] Cloudinary delete failed:', e.message);
        }
      }

      await s`DELETE FROM network_post_likes WHERE post_id = ${id}`;
      await s`DELETE FROM network_post_comments WHERE post_id = ${id}`;
      await s`DELETE FROM network_posts WHERE id = ${id}`;

      return reply.send({ ok: true, deleted: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Toggle like on a post
  app.post('/network-posts/:id/like', async (request, reply) => {
    try {
      const { id } = request.params;
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      // Verify post exists before touching like rows
      const postCheck = await s`SELECT id FROM network_posts WHERE id = ${id}`;
      if (postCheck.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found' });

      // Attempt DELETE first — count tells us if the row actually existed
      const delResult = await s`
        DELETE FROM network_post_likes WHERE post_id = ${id} AND wallet = ${wallet}
      `;

      let liked;
      if (delResult.count > 0) {
        // Row existed and was deleted — decrement only if we actually removed it
        await s`UPDATE network_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ${id}`;
        liked = false;
      } else {
        // Row did not exist — insert; ON CONFLICT guards against concurrent inserts
        const insResult = await s`
          INSERT INTO network_post_likes (post_id, wallet) VALUES (${id}, ${wallet}) ON CONFLICT DO NOTHING
        `;
        // Increment only if this request actually inserted the row (count > 0)
        if (insResult.count > 0) {
          await s`UPDATE network_posts SET likes_count = likes_count + 1 WHERE id = ${id}`;
        }
        liked = true;
      }

      const updated = await s`SELECT likes_count FROM network_posts WHERE id = ${id}`;
      const likesCount = updated.length > 0 ? updated[0].likes_count : 0;

      return reply.send({ ok: true, liked, likesCount });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Get comments for a post
  app.get('/network-posts/:id/comments', async (request, reply) => {
    try {
      const { id } = request.params;
      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const comments = await s`
        SELECT c.*, u.username, u.display_name, u.avatar_url
        FROM network_post_comments c
        LEFT JOIN user_profiles u ON c.wallet = u.wallet
        WHERE c.post_id = ${id}
        ORDER BY c.created_at ASC
      `;

      return reply.send({ ok: true, comments });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Add a comment to a post (NTC holders only)
  app.post('/network-posts/:id/comments', async (request, reply) => {
    try {
      const { id } = request.params;
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;

      const { body } = request.body || {};
      if (!body || !body.trim()) return reply.status(400).send({ ok: false, error: 'body required' });

      const holdsNtc = await walletHasNtc(wallet);
      if (!holdsNtc) {
        return reply.status(403).send({ ok: false, error: 'You must hold NTC tokens to comment.' });
      }

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const postCheck = await s`SELECT id FROM network_posts WHERE id = ${id}`;
      if (postCheck.length === 0) return reply.status(404).send({ ok: false, error: 'Post not found' });

      const result = await s`
        INSERT INTO network_post_comments (post_id, wallet, body)
        VALUES (${id}, ${wallet}, ${body.trim().slice(0, 2000)})
        RETURNING *
      `;

      await s`UPDATE network_posts SET comments_count = comments_count + 1 WHERE id = ${id}`;

      const profile = await s`
        SELECT username, display_name, avatar_url FROM user_profiles WHERE wallet = ${wallet}
      `;

      const comment = {
        ...result[0],
        username: profile[0]?.username || null,
        display_name: profile[0]?.display_name || null,
        avatar_url: profile[0]?.avatar_url || null,
      };

      return reply.send({ ok: true, comment });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });

  // Delete a comment (own comment or admin)
  app.delete('/network-posts/:id/comments/:commentId', async (request, reply) => {
    try {
      const { id, commentId } = request.params;
      const walletResult = requireWallet(request.raw, request.query);
      if (walletResult.error) return reply.status(walletResult.status).send(walletResult.body);
      const wallet = walletResult.walletAddress;

      const s = getSql();
      if (!s) return reply.status(500).send({ ok: false, error: 'Database not available' });

      const commentCheck = await s`
        SELECT id, wallet FROM network_post_comments WHERE id = ${commentId} AND post_id = ${id}
      `;
      if (commentCheck.length === 0) return reply.status(404).send({ ok: false, error: 'Comment not found' });

      const adminCheck = await isAdmin(wallet);
      if (commentCheck[0].wallet !== wallet && !adminCheck) {
        return reply.status(403).send({ ok: false, error: 'Not authorized' });
      }

      await s`DELETE FROM network_post_comments WHERE id = ${commentId}`;
      await s`UPDATE network_posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = ${id}`;

      return reply.send({ ok: true, deleted: true });
    } catch (e) {
      return reply.status(500).send({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerNetworkPostRoutes };
