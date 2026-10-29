const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { canBookCourt } = require('./src/utils/courtValidation');

dotenv.config();

const BASE_URL = 'http://localhost:9999/api';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 BẮT ĐẦU KIỂM CHỨNG TOÀN DIỆN MODULE QUẢN LÝ SÂN CẦU LÔNG');
  console.log('====================================================\n');

  // 1. Authenticate Admin, Staff, Customer
  console.log('--- 1. Kiểm tra Đăng nhập & Tạo Token ---');
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    body: { account: 'admin@gmail.com', password: '123456' }
  });
  assert(adminLogin.status === 200 && adminLogin.data.data?.token, 'Admin đăng nhập thành công và có JWT token');
  const adminToken = adminLogin.data?.data?.token;

  const staffLogin = await request('/auth/login', {
    method: 'POST',
    body: { account: 'staff@gmail.com', password: '123456' }
  });
  assert(staffLogin.status === 200 && staffLogin.data.data?.token, 'Staff đăng nhập thành công và có JWT token');
  const staffToken = staffLogin.data?.data?.token;

  const customerLogin = await request('/auth/login', {
    method: 'POST',
    body: { account: 'customer@gmail.com', password: '123456' }
  });
  assert(customerLogin.status === 200 && customerLogin.data.data?.token, 'Customer đăng nhập thành công và có JWT token');
  const customerToken = customerLogin.data?.data?.token;

  // 2. RBAC Access Control
  console.log('\n--- 2. Kiểm tra Phân quyền RBAC (BR-02) ---');
  const noTokenReq = await request('/courts');
  assert(noTokenReq.status === 401, 'Không có token bị từ chối 401');

  const customerGetCourts = await request('/courts', {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert(customerGetCourts.status === 403, 'Customer truy cập danh sách sân bị từ chối 403');

  const customerPostCourt = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { name: 'Customer Court' }
  });
  assert(customerPostCourt.status === 403, 'Customer tạo sân bị từ chối 403');

  // 3. UC-9.3 Create Court (Admin only)
  console.log('\n--- 3. Kiểm tra UC-9.3 Create Court ---');
  // Staff cannot create court
  const staffPostCourt = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: { name: 'Staff Court' }
  });
  assert(staffPostCourt.status === 403, 'Staff tạo sân bị từ chối 403 (chỉ Admin)');

  // Validation: Missing name
  const emptyNameRes = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { name: '   ', description: 'Test desc' }
  });
  assert(emptyNameRes.status === 400 && emptyNameRes.data?.errors?.name, 'Tên sân rỗng bị từ chối 400 kèm field error');

  // Validation: Invalid time format
  const invalidTimeRes = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { name: 'Test Court Bad Time', openingTime: '25:00', closingTime: '23:00' }
  });
  assert(invalidTimeRes.status === 400 && invalidTimeRes.data?.errors?.openingTime, 'Giờ mở cửa sai định dạng bị từ chối 400');

  // Validation: openingTime >= closingTime
  const badTimeOrderRes = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { name: 'Test Court Bad Order', openingTime: '22:00', closingTime: '06:00' }
  });
  assert(badTimeOrderRes.status === 400 && badTimeOrderRes.data?.errors?.closingTime, 'Giờ đóng cửa trước giờ mở cửa bị từ chối 400');

  // Successful creation of Court Alpha
  const createCourtAlpha = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Test Court Alpha',
      description: 'Sân thảm tiêu chuẩn Yonex',
      openingTime: '06:00',
      closingTime: '22:00'
    }
  });
  assert(createCourtAlpha.status === 201 && createCourtAlpha.data?.data?._id, 'Admin tạo sân Test Court Alpha thành công 201');
  assert(createCourtAlpha.data.data.status === 'ACTIVE', 'Sân mới tạo có trạng thái mặc định là ACTIVE');
  const courtAlphaId = createCourtAlpha.data.data._id;

  // Duplicate name check (case-insensitive)
  const duplicateNameRes = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: '  test court alpha  '
    }
  });
  assert(duplicateNameRes.status === 409 && duplicateNameRes.data?.errors?.name, 'Trùng lặp tên sân (case-insensitive) bị từ chối 409');

  // Create Court Beta
  const createCourtBeta = await request('/courts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Test Court Beta',
      description: 'Sân số 2 phòng VIP',
      openingTime: '05:00',
      closingTime: '23:00'
    }
  });
  assert(createCourtBeta.status === 201, 'Admin tạo sân Test Court Beta thành công 201');
  const courtBetaId = createCourtBeta.data?.data?._id;

  // 4. UC-9.1 View Court List
  console.log('\n--- 4. Kiểm tra UC-9.1 View Court List ---');
  // Admin views court list
  const adminCourtList = await request('/courts', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminCourtList.status === 200 && Array.isArray(adminCourtList.data?.data), 'Admin xem danh sách sân thành công (200, array)');
  assert(adminCourtList.data.data.some(c => c._id === courtAlphaId), 'Danh sách chứa Test Court Alpha');

  // Staff views court list
  const staffCourtList = await request('/courts', {
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(staffCourtList.status === 200 && Array.isArray(staffCourtList.data?.data), 'Staff xem danh sách sân thành công (200, array)');

  // 5. UC-9.2 View Court Detail
  console.log('\n--- 5. Kiểm tra UC-9.2 View Court Detail ---');
  // Staff views court detail
  const staffDetailRes = await request(`/courts/${courtAlphaId}`, {
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(staffDetailRes.status === 200 && staffDetailRes.data?.data?.name === 'Test Court Alpha', 'Staff xem chi tiết sân Test Court Alpha thành công 200');

  // Admin views court detail
  const adminDetailRes = await request(`/courts/${courtAlphaId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminDetailRes.status === 200 && adminDetailRes.data?.data?.name === 'Test Court Alpha', 'Admin xem chi tiết sân Test Court Alpha thành công 200');

  // Customer cannot view detail
  const customerDetailRes = await request(`/courts/${courtAlphaId}`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert(customerDetailRes.status === 403, 'Customer xem chi tiết sân bị từ chối 403');

  // Invalid ObjectId format
  const invalidIdRes = await request('/courts/invalid-object-id', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    invalidIdRes.status === 404 && invalidIdRes.data?.message === 'Unable to view the selected court record.',
    'ID không hợp lệ trả 404 với thông báo "Unable to view the selected court record."'
  );

  // Non-existent ObjectId
  const fakeId = new mongoose.Types.ObjectId().toString();
  const notFoundRes = await request(`/courts/${fakeId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    notFoundRes.status === 404 && notFoundRes.data?.message === 'Unable to view the selected court record.',
    'Sân không tồn tại trả 404 với thông báo "Unable to view the selected court record."'
  );

  // 6. UC-9.4 Update Court (Admin only)
  console.log('\n--- 6. Kiểm tra UC-9.4 Update Court ---');
  // Staff cannot update
  const staffUpdateRes = await request(`/courts/${courtAlphaId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: { name: 'Staff Hacked Name' }
  });
  assert(staffUpdateRes.status === 403, 'Staff cập nhật sân bị từ chối 403');

  // Validation failure on update
  const invalidUpdateRes = await request(`/courts/${courtAlphaId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { name: '', closingTime: '04:00' }
  });
  assert(invalidUpdateRes.status === 400 && invalidUpdateRes.data?.errors?.name, 'Cập nhật với tên rỗng bị từ chối 400 kèm field errors');

  // Duplicate name on update (trying to take Beta\'s name)
  const duplicateUpdateRes = await request(`/courts/${courtAlphaId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { name: 'Test Court Beta' }
  });
  assert(duplicateUpdateRes.status === 409 && duplicateUpdateRes.data?.errors?.name, 'Cập nhật trùng tên sân khác bị từ chối 409');

  // Successful update
  const successUpdateRes = await request(`/courts/${courtAlphaId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Test Court Alpha Updated',
      description: 'Mô tả đã được cập nhật',
      openingTime: '05:30',
      closingTime: '22:30'
    }
  });
  assert(successUpdateRes.status === 200, 'Admin cập nhật sân Test Court Alpha Updated thành công 200');
  assert(successUpdateRes.data?.data?.name === 'Test Court Alpha Updated', 'Tên sân đã được cập nhật');
  assert(successUpdateRes.data?.data?.status === 'ACTIVE', 'Cập nhật thông thường không làm thay đổi trạng thái ACTIVE');

  // Non-existent ID for update
  const notFoundUpdateRes = await request(`/courts/${fakeId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { name: 'Non Existent' }
  });
  assert(
    notFoundUpdateRes.status === 404 && notFoundUpdateRes.data?.message === 'The selected court is unavailable.',
    'Cập nhật sân không tồn tại trả 404 với thông báo "The selected court is unavailable."'
  );

  // 7. UC-9.5 Deactivate Court (Admin only)
  console.log('\n--- 7. Kiểm tra UC-9.5 Deactivate Court ---');
  // Staff cannot deactivate
  const staffDeactivateRes = await request(`/courts/${courtAlphaId}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(staffDeactivateRes.status === 403, 'Staff vô hiệu hóa sân bị từ chối 403');

  // Admin deactivates court
  const adminDeactivateRes = await request(`/courts/${courtAlphaId}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminDeactivateRes.status === 200, 'Admin vô hiệu hóa sân thành công 200');
  assert(adminDeactivateRes.data?.data?.status === 'INACTIVE', 'Trạng thái sân chuyển thành INACTIVE');
  assert(adminDeactivateRes.data?.data?._id === courtAlphaId, 'BR-40: Giữ nguyên _id sân sau khi vô hiệu hóa');

  // Idempotency: deactivating already inactive court
  const repeatDeactivateRes = await request(`/courts/${courtAlphaId}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(repeatDeactivateRes.status === 200, 'Vô hiệu hóa lại sân đã INACTIVE trả về 200 không phát sinh lỗi');
  assert(repeatDeactivateRes.data?.data?.status === 'INACTIVE', 'Trạng thái giữ nguyên INACTIVE');

  // Non-existent ID for deactivate
  const notFoundDeactivateRes = await request(`/courts/${fakeId}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    notFoundDeactivateRes.status === 404 && notFoundDeactivateRes.data?.message === 'The selected court is unavailable.',
    'Vô hiệu hóa sân không tồn tại trả 404 với thông báo "The selected court is unavailable."'
  );

  // 8. UC-9.6 Search/Filter Court (Admin only, BR-38)
  console.log('\n--- 8. Kiểm tra UC-9.6 Search/Filter Court & BR-38 ---');
  // BR-38: Staff calling search query must receive 403
  const staffSearchRes = await request('/courts?search=Beta', {
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(staffSearchRes.status === 403, 'BR-38: Staff gọi query search bị từ chối 403');

  // BR-38: Staff calling status filter must receive 403
  const staffStatusRes = await request('/courts?status=ACTIVE', {
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(staffStatusRes.status === 403, 'BR-38: Staff gọi query status filter bị từ chối 403');

  // Admin search by partial name
  const adminSearchName = await request('/courts?search=Beta', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminSearchName.status === 200, 'Admin tìm kiếm theo tên thành công 200');
  assert(adminSearchName.data?.data?.some(c => c._id === courtBetaId), 'Kết quả tìm kiếm chứa Test Court Beta');
  assert(!adminSearchName.data?.data?.some(c => c._id === courtAlphaId), 'Kết quả tìm kiếm không chứa Test Court Alpha');

  // Admin search with leading/trailing spaces & case-insensitive
  const adminSearchTrim = await request('/courts?search=' + encodeURIComponent('  alpha updated  '), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminSearchTrim.status === 200 && adminSearchTrim.data?.data?.some(c => c._id === courtAlphaId), 'Tìm kiếm trim khoảng trắng & không phân biệt hoa thường thành công');

  // Admin search with regex special characters (must be safely escaped, no crash)
  const regexSearch = await request('/courts?search=' + encodeURIComponent('Test Court [Alpha]* (Updated)?'), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(regexSearch.status === 200, 'Tìm kiếm với ký tự đặc biệt regex được escape an toàn, không crash (200)');

  // Admin filter by status INACTIVE
  const adminFilterInactive = await request('/courts?status=INACTIVE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminFilterInactive.status === 200, 'Admin lọc trạng thái INACTIVE thành công 200');
  assert(adminFilterInactive.data?.data?.some(c => c._id === courtAlphaId), 'Kết quả lọc INACTIVE chứa Test Court Alpha Updated');
  assert(!adminFilterInactive.data?.data?.some(c => c._id === courtBetaId), 'Kết quả lọc INACTIVE không chứa Test Court Beta (ACTIVE)');

  // Admin filter by status ACTIVE
  const adminFilterActive = await request('/courts?status=ACTIVE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminFilterActive.status === 200, 'Admin lọc trạng thái ACTIVE thành công 200');
  assert(adminFilterActive.data?.data?.some(c => c._id === courtBetaId), 'Kết quả lọc ACTIVE chứa Test Court Beta');

  // Admin combined search and status filter
  const adminCombinedFilter = await request('/courts?search=Alpha&status=INACTIVE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminCombinedFilter.status === 200 && adminCombinedFilter.data?.data?.some(c => c._id === courtAlphaId), 'Kết hợp tìm tên và lọc trạng thái thành công');

  // Admin search with no match -> empty list [] (not an error)
  const adminNoMatch = await request('/courts?search=NonExistentCourtNameXYZ', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminNoMatch.status === 200 && Array.isArray(adminNoMatch.data?.data) && adminNoMatch.data.data.length === 0, 'Tìm không thấy kết quả trả về danh sách rỗng 200');

  // Admin search query validation (> 100 chars)
  const longQuery = 'A'.repeat(101);
  const adminLongSearch = await request('/courts?search=' + longQuery, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminLongSearch.status === 400, 'Từ khóa vượt quá 100 ký tự bị từ chối 400');

  // Admin invalid status query
  const adminBadStatus = await request('/courts?status=UNKNOWN_STATUS', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminBadStatus.status === 400, 'Trạng thái lọc không hợp lệ bị từ chối 400');

  // 9. BR-08 & BR-09 Booking Condition Validation Helper
  console.log('\n--- 9. Kiểm tra Business Rules BR-08 & BR-09 (canBookCourt helper) ---');
  const activeCourt = {
    _id: courtBetaId,
    name: 'Test Court Beta',
    status: 'ACTIVE',
    openingTime: '05:00',
    closingTime: '23:00'
  };

  const inactiveCourt = {
    _id: courtAlphaId,
    name: 'Test Court Alpha Updated',
    status: 'INACTIVE',
    openingTime: '05:00',
    closingTime: '23:00'
  };

  // BR-09: Sân INACTIVE không nhận booking
  const checkInactiveBooking = canBookCourt(inactiveCourt, '08:00', '10:00');
  assert(!checkInactiveBooking.canBook && checkInactiveBooking.reason.includes('BR-09'), 'BR-09: Sân INACTIVE bị từ chối đặt sân');

  // BR-08: Sân ACTIVE trong giờ hoạt động được phép đặt
  const checkValidBooking = canBookCourt(activeCourt, '08:00', '10:00');
  assert(checkValidBooking.canBook === true, 'BR-08: Sân ACTIVE trong giờ hoạt động được phép đặt sân');

  // BR-08: Đặt sân trước giờ mở cửa
  const checkEarlyBooking = canBookCourt(activeCourt, '04:00', '06:00');
  assert(!checkEarlyBooking.canBook && checkEarlyBooking.reason.includes('BR-08'), 'BR-08: Đặt trước giờ mở cửa bị từ chối');

  // BR-08: Đặt sân sau giờ đóng cửa
  const checkLateBooking = canBookCourt(activeCourt, '22:00', '23:30');
  assert(!checkLateBooking.canBook && checkLateBooking.reason.includes('BR-08'), 'BR-08: Đặt quá giờ đóng cửa bị từ chối');

  // 10. Clean up test courts (Isolated cleanup)
  console.log('\n--- 10. Dọn dẹp dữ liệu kiểm thử cô lập ---');
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const Court = require('./src/models/court');
    const deleteResult = await Court.deleteMany({ name: { $regex: /^Test Court/i } });
    console.log(`     (Đã xóa ${deleteResult.deletedCount} sân kiểm thử "Test Court*")`);
    await mongoose.disconnect();
    assert(true, 'Dọn dẹp sân kiểm thử thành công, giữ nguyên các dữ liệu khác');
  } catch (err) {
    console.error('Lỗi dọn dẹp:', err);
  }

  console.log('\n====================================================');
  console.log(`KẾT QUẢ: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('====================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
