const { Connection, PublicKey } = require('@solana/web3.js');

async function checkAccount() {
  try {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const programId = new PublicKey('CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB');
    const ownerPk = new PublicKey('Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc');
    
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('agent'), ownerPk.toBuffer()], programId);
    console.log('PDA:', pda.toBase58());
    
    const account = await connection.getAccountInfo(pda);
    if (account) {
      console.log('Account exists');
      console.log('Owner:', account.owner.toBase58());
      console.log('Data length:', account.data.length);
      console.log('First 16 bytes (discriminator area):', account.data.slice(0, 16).toString('hex'));
      console.log('Program ID correct:', account.owner.toBase58() === programId.toBase58());
    } else {
      console.log('Account does not exist');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

checkAccount();
