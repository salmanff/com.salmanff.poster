
document.addEventListener('click', function (evt) {
	console.log(evt.target.className)
	if (evt.target.className == "expandpost") {
		// console.log("Got event")
		evt.target.style.display="none";
		let textdiv = evt.target.parentElement.previousElementSibling
		textdiv.className = "post_body_full";
	}
	if(evt.target.id == "bottomdate"){
		let earliestdate = getEarliestDate ()
		// console.log("now earliestdate"+earliestdate)
		window.location="?maxdate="+earliestdate
	}
})
const getEarliestDate = function(){
	let earliestdate, aDate;
	let dateList = document.getElementsByClassName("real_date");
	Array.prototype.forEach.call(dateList, function(aDate) {
		// console.log("current considering "+aDate.innerHTML+" versus prev earliestdate "+earliestdate)
		if (!earliestdate || parseInt(aDate.innerHTML)<earliestdate) earliestdate=parseInt(aDate.innerHTML);
	});
	return earliestdate
}
