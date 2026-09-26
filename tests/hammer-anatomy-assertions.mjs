import assert from 'node:assert/strict';

/** Check the imported body, not just the hidden tool-control arm endpoints. */
export function assertHammerAnatomy(report) {
  assert.equal(report.cases.length,9,'Missing standing, crouch, work or jump views');
  assert.deepEqual(report.errors,[]);
  for(const pose of report.cases){
    for(const side of ['L','R']){
      const arm=pose.arms[side];
      assert(arm.clavicleDegrees<=25.1,`${pose.name}/${side}: clavicle rotated ${arm.clavicleDegrees} degrees`);
      assert(arm.elbowHingeError<2,`${pose.name}/${side}: elbow skin bends across its authored crease`);
      assert(arm.elbowFlexion<150,`${pose.name}/${side}: folded elbow`);
      assert(pose.body.gripReachErrors[side]<.006,`${pose.name}/${side}: hand detached from the physical grip`);
      assert(pose.body.fingerFit['hammerWrist'+side].bendDegrees<15,`${pose.name}/${side}: wrist kink`);
    }
    assert.equal(pose.pose.arms.find(a=>a.gripRole==='rear').side,1,`${pose.name}: default right rear hand changed`);
    if(pose.name.includes('breaking')){
      assert(pose.newImpacts>0,`${pose.name}: pose without a real masonry strike`);
      assert(pose.arms.R.elbowFlexion>10,`${pose.name}: loaded rear elbow is locked straight`);
    }
  }
}
