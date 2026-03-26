/**
 * NFT Avatar API Routes
 * 
 * Universal avatar resolution for AI agents
 */

const express = require('express');
const router = express.Router();
const { setNFTAvatar, getNFTAvatar, removeNFTAvatar, listWalletNFTs, SUPPORTED_CHAINS } = require('../lib/nft-avatar');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/agent/:id/avatar
 * Public: Resolve an agent's verified NFT avatar
 * This is THE universal endpoint other platforms call
 */
router.get('/agent/:id/avatar', async (req, res) => {
  try {
    const avatar = getNFTAvatar(req.params.id);
    if (!avatar) {
      return res.status(404).json({ 
        error: 'No NFT avatar set',
        hint: 'Agent has not linked an NFT avatar yet',
        default: true,
        image: null // Could return default Bored Robots placeholder
      });
    }

    res.json({
      profileId: req.params.id,
      avatar: {
        chain: avatar.chain,
        identifier: avatar.identifier,
        name: avatar.name,
        image: avatar.image,
        verifiedOnChain: avatar.verifiedOnChain,
        verifiedAt: avatar.verifiedAt
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to resolve avatar' });
  }
});

/**
 * GET /api/agent/:id/avatar/image
 * Public: Redirect to the avatar image directly (for embedding)
 * Usage: <img src="https://agentfolio.bot/api/agent/brainkid/avatar/image" />
 */
router.get('/agent/:id/avatar/image', async (req, res) => {
  try {
    const avatar = getNFTAvatar(req.params.id);
    if (!avatar || !avatar.image) {
      // Return default placeholder
      return res.redirect('/public/img/default-agent-avatar.png');
    }
    res.redirect(avatar.image);
  } catch (e) {
    res.redirect('/public/img/default-agent-avatar.png');
  }
});

/**
 * POST /api/avatar/set
 * Auth required: Link an NFT as avatar (verifies on-chain ownership)
 */
router.post('/avatar/set', requireAuth, async (req, res) => {
  try {
    const { chain, walletAddress, nftIdentifier, nftName, nftImage } = req.body;

    if (!chain || !walletAddress || !nftIdentifier) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['chain', 'walletAddress', 'nftIdentifier'],
        optional: ['nftName', 'nftImage'],
        supportedChains: SUPPORTED_CHAINS
      });
    }

    const result = await setNFTAvatar(req.profileId, {
      chain, walletAddress, nftIdentifier, nftName, nftImage
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, avatar: result.avatar });
  } catch (e) {
    res.status(500).json({ error: 'Failed to set avatar', details: e.message });
  }
});

/**
 * DELETE /api/avatar
 * Auth required: Remove NFT avatar
 */
router.delete('/avatar', requireAuth, async (req, res) => {
  try {
    const result = removeNFTAvatar(req.profileId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

/**
 * GET /api/avatar/nfts/:chain/:wallet
 * Auth required: List NFTs in wallet for avatar selection UI
 */
router.get('/avatar/nfts/:chain/:wallet', async (req, res) => {
  try {
    const { chain, wallet } = req.params;
    if (!SUPPORTED_CHAINS.includes(chain)) {
      return res.status(400).json({ error: `Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}` });
    }

    const nfts = await listWalletNFTs(chain, wallet);
    res.json({ chain, wallet, count: nfts.length, nfts });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch NFTs', details: e.message });
  }
});

module.exports = router;
