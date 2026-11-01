/* Day or night, same rule as the home page: the visitor's choice, then a
   ?look= link, then the clock in Trinidad (6am to 6pm is day). */
(function(){
  var root=document.documentElement,look=null;
  try{look=localStorage.getItem('g868-look')}catch(e){}
  try{var q=new URLSearchParams(location.search).get('look');if(q==='day'||q==='night')look=q}catch(e){}
  if(look!=='day'&&look!=='night'){
    var h;
    try{h=parseInt(new Intl.DateTimeFormat('en-US',{timeZone:'America/Port_of_Spain',hour:'numeric',hour12:false}).format(new Date()),10)%24}catch(e){h=new Date().getHours()}
    look=(h>=6&&h<18)?'day':'night';
  }
  root.setAttribute('data-time',look);
  document.addEventListener('DOMContentLoaded',function(){
    var sw=document.getElementById('lookSwitch'),word=document.getElementById('lookWord');
    function paint(){
      var day=root.getAttribute('data-time')==='day';
      if(word)word.textContent=day?'Day':'Night';
      if(sw)sw.setAttribute('aria-label',day?'Switch to the night look':'Switch to the day look');
    }
    paint();
    if(sw)sw.addEventListener('click',function(){
      var next=root.getAttribute('data-time')==='day'?'night':'day';
      root.setAttribute('data-time',next);
      try{localStorage.setItem('g868-look',next)}catch(e){}
      paint();
    });
  });
})();
