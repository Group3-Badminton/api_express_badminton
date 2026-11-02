const mongoose = require('mongoose');
require('dotenv').config();

async function runMigration() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bad2';
  console.log('Connecting to MongoDB:', uri);
  await mongoose.connect(uri);

  const db = mongoose.connection.db;
  const legacyUsers = await db.collection('User').find({}).toArray();
  console.log(`Found ${legacyUsers.length} legacy users in User collection.`);

  let staffCount = 0;
  let customerCount = 0;

  for (const user of legacyUsers) {
    if (user.role === 'ADMIN' || user.role === 'STAFF') {
      const staffDoc = {
        _id: user._id,
        fullName: user.fullName || '',
        email: (user.email || '').toLowerCase().trim(),
        password: user.password,
        phone: user.phone || '',
        address: user.address || '',
        role: user.role,
        status: user.status || 'ACTIVE',
        resetOtp: user.resetOtp || null,
        resetOtpExpiry: user.resetOtpExpiry || null,
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date()
      };
      await db.collection('Staff').updateOne(
        { _id: user._id },
        { $set: staffDoc },
        { upsert: true }
      );
      staffCount++;
      console.log(`  -> Synced to Staff: ${staffDoc.email} (${staffDoc.role})`);
    } else {
      const customerDoc = {
        _id: user._id,
        fullName: user.fullName || '',
        email: (user.email || '').toLowerCase().trim(),
        password: user.password,
        phone: user.phone || '',
        address: user.address || '',
        role: 'CUSTOMER',
        status: user.status || 'ACTIVE',
        lockReason: user.lockReason || '',
        lockedAt: user.lockedAt || null,
        lockedByBookingId: user.lockedByBookingId || null,
        bookingCancellationVersion: user.bookingCancellationVersion || 0,
        cancellationLockToken: user.cancellationLockToken || null,
        cancellationLockUntil: user.cancellationLockUntil || null,
        resetOtp: user.resetOtp || null,
        resetOtpExpiry: user.resetOtpExpiry || null,
        bookingCancellationHistory: user.bookingCancellationHistory || [],
        accountLockHistory: user.accountLockHistory || [],
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date()
      };
      await db.collection('Customer').updateOne(
        { _id: user._id },
        { $set: customerDoc },
        { upsert: true }
      );
      customerCount++;
      console.log(`  -> Synced to Customer: ${customerDoc.email} (${customerDoc.fullName})`);
    }
  }

  const finalStaffs = await db.collection('Staff').countDocuments();
  const finalCustomers = await db.collection('Customer').countDocuments();
  console.log(`\nMigration completed successfully!`);
  console.log(`Staff collection count: ${finalStaffs}`);
  console.log(`Customer collection count: ${finalCustomers}`);

  process.exit(0);
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
